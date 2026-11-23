// Spike: a userspace tailnet node that forwards :8765 to the local bridge.
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
	"sync"
	"time"

	"tailscale.com/tsnet"
)

var (
	dir      = flag.String("dir", "state", "state directory")
	hostname = flag.String("hostname", "dsh-bridge", "tailnet hostname")
	listen   = flag.String("listen", ":8765", "port to listen on inside the tailnet")
	target   = flag.String("target", "127.0.0.1:8765", "local address to forward to")
	control  = flag.String("control", "127.0.0.1:8799", "localhost control endpoint")
	authKey  = flag.String("authkey", "", "optional auth key")
)

func main() {
	flag.Parse()
	os.MkdirAll(*dir, 0o755)
	srv := &tsnet.Server{
		Dir:       *dir,
		Hostname:  *hostname,
		AuthKey:   *authKey,
		Logf:      func(string, ...any) {},
		UserLogf:  func(string, ...any) {},
		Ephemeral: false,
	}
	defer srv.Close()

	var stateMu sync.Mutex
	state := map[string]any{"stage": "starting"}

	http.HandleFunc("/status", func(w http.ResponseWriter, r *http.Request) {
		stateMu.Lock()
		defer stateMu.Unlock()
		w.Header().Set("content-type", "application/json")
		json.NewEncoder(w).Encode(state)
	})
	go func() {
		if err := http.ListenAndServe(*control, nil); err != nil {
			log.Printf("control: %v", err)
		}
	}()

	// Watch the backend state so the caller can show a login link.
	go func() {
		for {
			lc, err := srv.LocalClient()
			if err == nil {
				st, err := lc.StatusWithoutPeers(context.Background())
				if err == nil {
					stateMu.Lock()
					state["backend"] = string(st.BackendState)
					state["authUrl"] = st.AuthURL
					state["ips"] = st.TailscaleIPs
					state["name"] = st.Self.HostName
					if st.BackendState == "Running" {
						state["stage"] = "running"
					} else if st.BackendState == "NeedsLogin" {
						state["stage"] = "needsLogin"
					}
					stateMu.Unlock()
				}
			}
			time.Sleep(2 * time.Second)
		}
	}()

	ln, err := srv.Listen("tcp", *listen)
	if err != nil {
		fmt.Fprintln(os.Stderr, "listen:", err)
		os.Exit(1)
	}
	fmt.Println("listening on tailnet", *listen, "-> forward", *target)
	for {
		c, err := ln.Accept()
		if err != nil {
			continue
		}
		go func(in net.Conn) {
			defer in.Close()
			out, err := net.Dial("tcp", *target)
			if err != nil {
				return
			}
			defer out.Close()
			go io.Copy(out, in)
			io.Copy(in, out)
		}(c)
	}
}
