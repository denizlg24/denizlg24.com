package main

import (
	"context"
	"fmt"
	"log"
	"net"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/charmbracelet/lipgloss"
	"github.com/charmbracelet/ssh"
	"github.com/charmbracelet/wish"
	"github.com/charmbracelet/wish/logging"
	"github.com/muesli/termenv"
)

const portrait = `........................................
........................................
.......###################..............
.......##---------------%###............
.......##------------------##...........
.......####----#######------%##.........
.........##----#########----%##%%.......
.........##----#########----%##%%.......
.........##----#########----%##%%.......
.........##----#########----%##%%.......
.........##----#######------%##%%.......
.......##------------------####%%.......
.......##---------------#####%%%%.......
.......######################%%%%.......
.......####################%%%%.........
.........%%%%%%%%%%%%%%%%%%%%-..........
........................................
........................................
`

func main() {
	if os.Getenv("PREVIEW") == "1" {
		r := lipgloss.NewRenderer(os.Stdout)
		r.SetColorProfile(termenv.TrueColor)
		fmt.Print(render(r, 80))
		return
	}

	host := envOr("HOST", "0.0.0.0")
	port := envOr("PORT", "22")
	keyPath := envOr("HOST_KEY_PATH", ".ssh/host_key")

	s, err := wish.NewServer(
		wish.WithAddress(net.JoinHostPort(host, port)),
		wish.WithHostKeyPath(keyPath),
		wish.WithMiddleware(
			displayMiddleware(),
			logging.Middleware(),
		),
	)
	if err != nil {
		log.Fatalf("failed to start server: %v", err)
	}

	done := make(chan os.Signal, 1)
	signal.Notify(done, os.Interrupt, syscall.SIGINT, syscall.SIGTERM)
	log.Printf("ssh server listening on %s:%s", host, port)

	go func() {
		if err := s.ListenAndServe(); err != nil {
			log.Printf("server stopped: %v", err)
		}
	}()

	<-done
	log.Println("shutting down...")
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := s.Shutdown(ctx); err != nil {
		log.Fatalf("shutdown error: %v", err)
	}
}

func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func displayMiddleware() wish.Middleware {
	return func(next ssh.Handler) ssh.Handler {
		return func(sess ssh.Session) {
			width := 80
			pty, _, ok := sess.Pty()
			if ok && pty.Window.Width > 0 {
				width = pty.Window.Width
			}

			renderer := lipgloss.NewRenderer(sess)
			renderer.SetColorProfile(termenv.TrueColor)
			output := render(renderer, width)
			fmt.Fprint(sess, output)
			next(sess)
		}
	}
}

type styledText struct {
	text  string
	style lipgloss.Style
	url   string
}

func hyperlink(url, text string) string {
	return fmt.Sprintf("\x1b]8;;%s\x1b\\%s\x1b]8;;\x1b\\", url, text)
}

var birthDate = time.Date(2004, time.April, 24, 0, 0, 0, 0, time.UTC)

func ageOn(now time.Time) int {
	age := now.Year() - birthDate.Year()
	if now.Month() < birthDate.Month() ||
		(now.Month() == birthDate.Month() && now.Day() < birthDate.Day()) {
		age--
	}
	return age
}

func lerpColor(from, to [3]int, t float64) lipgloss.Color {
	r := int(float64(from[0]) + (float64(to[0])-float64(from[0]))*t)
	g := int(float64(from[1]) + (float64(to[1])-float64(from[1]))*t)
	b := int(float64(from[2]) + (float64(to[2])-float64(from[2]))*t)
	return lipgloss.Color(fmt.Sprintf("#%02x%02x%02x", r, g, b))
}

func render(r *lipgloss.Renderer, width int) string {
	nameStyle := r.NewStyle().Foreground(lipgloss.Color("#ffffff")).Bold(true)
	subStyle := r.NewStyle().Foreground(lipgloss.Color("#a0a0a0"))
	urlStyle := r.NewStyle().Foreground(lipgloss.Color("#87afaf"))
	dimStyle := r.NewStyle().Foreground(lipgloss.Color("#555555"))
	techStyle := r.NewStyle().Foreground(lipgloss.Color("#888888"))

	gap := "   "
	indent := "  "

	artLines := strings.Split(portrait, "\n")

	age := ageOn(time.Now())

	txt := func(s string, st lipgloss.Style) styledText { return styledText{text: s, style: st} }
	link := func(s, u string, st lipgloss.Style) styledText { return styledText{text: s, style: st, url: u} }

	info := []styledText{
		txt("", subStyle),
		txt("Deniz Lopes Güneş", nameStyle),
		txt(fmt.Sprintf("%d yo software engineer", age), subStyle),
		txt("porto, pt · lyngby, dk", subStyle),
		txt("", subStyle),
		link("denizlg24.com", "https://denizlg24.com", urlStyle),
		txt("", subStyle),
		txt("founder · ocean informatix", dimStyle),
		txt("bsc computer engineering · feup", dimStyle),
		txt("msc computer science & engineering · dtu", dimStyle),
		txt("", subStyle),
		link("github.com/denizlg24", "https://github.com/denizlg24", urlStyle),
		link("linkedin.com/in/deniz-güneş", "https://www.linkedin.com/in/deniz-güneş", urlStyle),
		link("denizlg24@gmail.com", "mailto:denizlg24@gmail.com", urlStyle),
		txt("", subStyle),
		txt("next.js · react · typescript", techStyle),
		txt("rust · c++ · java", techStyle),
	}

	gradTop := [3]int{0x4a, 0x7c, 0x2f}
	gradBottom := [3]int{0x5c, 0x3d, 0x1e}

	var b strings.Builder
	b.WriteString("\n")

	lastArt := len(artLines) - 1
	for i, artLine := range artLines {
		t := 0.0
		if lastArt > 0 {
			t = float64(i) / float64(lastArt)
		}
		artStyle := r.NewStyle().Foreground(lerpColor(gradTop, gradBottom, t))
		line := indent + artStyle.Render(artLine)
		if i < len(info) && info[i].text != "" {
			rendered := info[i].style.Render(info[i].text)
			if info[i].url != "" {
				rendered = hyperlink(info[i].url, rendered)
			}
			line += gap + rendered
		}
		b.WriteString(line + "\n")
	}

	b.WriteString("\n")
	return b.String()
}
