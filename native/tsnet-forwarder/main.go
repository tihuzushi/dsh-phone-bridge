//go:build windows

// dsh-tsnet is the built-in tailnet node for the DSH phone bridge on this PC.
//
// It is the same idea as the node the phone app carries: a userspace tailnet
// member that needs no administrator rights, no system Tailscale install and
// no service. It listens on the tailnet and forwards every connection to the
// bridge's private loopback ingress, so the phone reaches the bridge at
//
//	http://<tailnet-ip>:8765/
//
// The plugin starts it, watches /status and shows the login link when the node
// still has to join the tailnet.
package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"sync"
	"syscall"
	"time"

	"tailscale.com/tsnet"
)

type status struct {
	Stage   string   `json:"stage"`   // starting | needsLogin | running | error
	Backend string   `json:"backend"` // BackendState reported by the node
	AuthURL string   `json:"authUrl"`
	Name    string   `json:"name"`
	IPs     []string `json:"ips"`
	Target  string   `json:"target"`
	Error   string   `json:"error"`
}

type state struct {
	mu sync.Mutex
	st status
}

func (s *state) update(fn func(*status)) {
	s.mu.Lock()
	defer s.mu.Unlock()
	fn(&s.st)
}

func (s *state) snapshot() status {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := s.st
	out.IPs = append([]string(nil), s.st.IPs...)
	return out
}

func main() {
	dir := flag.String("dir", "", "state directory (keeps the tailnet login)")
	hostname := flag.String("hostname", "dsh-bridge", "hostname shown in the tailnet")
	listen := flag.String("listen", ":8765", "port to listen on inside the tailnet")
	target := flag.String("target", "127.0.0.1:8766", "bridge ingress to forward to")
	control := flag.String("control", "127.0.0.1:8799", "loopback control endpoint for the plugin")
	flag.Parse()

	if *dir == "" {
		fmt.Fprintln(os.Stderr, "missing -dir")
		os.Exit(2)
	}
	if err := os.MkdirAll(*dir, 0o755); err != nil {
		fmt.Fprintln(os.Stderr, "state dir:", err)
		os.Exit(2)
	}

	s := &state{st: status{Stage: "starting", Target: *target}}

	// The plugin polls this. Loopback only: it carries the login link.
	mux := http.NewServeMux()
	mux.HandleFunc("/status", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("content-type", "application/json; charset=utf-8")
		w.Header().Set("cache-control", "no-store")
		json.NewEncoder(w).Encode(s.snapshot())
	})
	mux.HandleFunc("/ping", func(w http.ResponseWriter, r *http.Request) {
		io.WriteString(w, "ok")
	})
	controlLn, err := net.Listen("tcp", *control)
	if err != nil {
		fmt.Fprintln(os.Stderr, "control listen:", err)
		os.Exit(1)
	}
	controlSrv := &http.Server{Handler: mux}
	go func() {
		if err := controlSrv.Serve(controlLn); err != nil && err != http.ErrServerClosed {
			log.Printf("control: %v", err)
		}
	}()

	srv := &tsnet.Server{
		Dir:      *dir,
		Hostname: *hostname,
		Logf:     func(string, ...any) {},
		UserLogf: func(string, ...any) {},
	}
	defer srv.Close()

	// Track the node state so the plugin can show "登录一次即可" with the link.
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go func() {
		for {
			select {
			case <-ctx.Done():
				return
			case <-time.After(2 * time.Second):
			}
			lc, err := srv.LocalClient()
			if err != nil {
				s.update(func(st *status) { st.Error = err.Error() })
				continue
			}
			line, err := lc.StatusWithoutPeers(ctx)
			if err != nil {
				s.update(func(st *status) { st.Error = err.Error() })
				continue
			}
			ips := make([]string, 0, len(line.TailscaleIPs))
			for _, ip := range line.TailscaleIPs {
				ips = append(ips, ip.String())
			}
			backend := string(line.BackendState)
			s.update(func(st *status) {
				st.Backend = backend
				st.AuthURL = line.AuthURL
				st.Name = line.Self.HostName
				st.IPs = ips
				st.Error = ""
				switch backend {
				case "Running":
					st.Stage = "running"
				case "NeedsLogin":
					st.Stage = "needsLogin"
				case "Stopped", "NoState":
					st.Stage = "starting"
				default:
					st.Stage = "starting"
				}
			})
		}
	}()

	ln, err := srv.Listen("tcp", *listen)
	if err != nil {
		fmt.Fprintln(os.Stderr, "tailnet listen:", err)
		s.update(func(st *status) { st.Stage = "error"; st.Error = err.Error() })
		time.Sleep(2 * time.Second)
		os.Exit(1)
	}
	fmt.Printf("listening on tailnet %s -> %s\n", *listen, *target)

	// Ctrl+C / service stop closes the listener so the loop ends.
	sig := make(chan os.Signal, 1)
	signal.Notify(sig, os.Interrupt, syscall.SIGTERM)
	go func() {
		<-sig
		cancel()
		ln.Close()
		controlSrv.Close()
	}()

	for {
		in, err := ln.Accept()
		if err != nil {
			return
		}
		go forward(in, *target)
	}
}

// forward pipes one tailnet connection to the bridge's loopback ingress.
func forward(in net.Conn, target string) {
	defer in.Close()
	out, err := net.DialTimeout("tcp", target, 5*time.Second)
	if err != nil {
		return
	}
	defer out.Close()
	done := make(chan struct{}, 2)
	go func() { io.Copy(out, in); done <- struct{}{} }()
	go func() { io.Copy(in, out); done <- struct{}{} }()
	<-done
}
