"use client";

import { Mail, Webhook } from "lucide-react";
import { useRef } from "react";
import { useMotion } from "@/components/marketing/motion";

const channels = [
  { name: "Email", icon: "mail" },
  { name: "Telegram", src: "/brand/telegram.svg" },
  { name: "WhatsApp", src: "/brand/whatsapp.svg" },
  { name: "Slack", src: "/brand/slack.svg" },
  { name: "Discord", src: "/brand/discord.svg" },
  { name: "ntfy", src: "/brand/ntfy.svg" },
  { name: "Webhooks", icon: "webhook" },
] as const;

const rowHeight = 48;
const height = channels.length * rowHeight;
const fanPath = (index: number) => {
  const y = index * rowHeight + rowHeight / 2;
  return `M0 ${height / 2} C 90 ${height / 2}, 110 ${y}, 200 ${y}`;
};

export function AlertsFan() {
  const ref = useRef<HTMLDivElement>(null);

  useMotion(ref, ({ motion }, { gsap }) => {
    const root = ref.current;
    if (!root || !motion) return;
    const rule = root.querySelector(".fan-rule");
    const trails = root.querySelectorAll(".fan-trail");
    const rows = root.querySelectorAll(".fan-channels li");
    gsap
      .timeline({
        scrollTrigger: { trigger: root, start: "top 72%", once: true },
      })
      .fromTo(
        rule,
        { "--fired": 0 },
        { "--fired": 1, duration: 0.35, ease: "power2.out" },
      )
      .fromTo(
        trails,
        { strokeDashoffset: 1 },
        {
          strokeDashoffset: 0,
          duration: 0.7,
          stagger: 0.06,
          ease: "power2.inOut",
        },
        "<0.1",
      )
      .from(
        rows,
        {
          opacity: 0,
          x: -14,
          duration: 0.45,
          stagger: 0.06,
          ease: "power3.out",
        },
        "<0.35",
      );
  });

  return (
    <div className="fan" ref={ref}>
      <div className="fan-rule">
        <code>breadth(S&amp;P 500, 50d) &lt; 40%</code>
        <span>Checked daily after the US close</span>
      </div>
      <svg
        className="fan-lines"
        viewBox={`0 0 200 ${height}`}
        preserveAspectRatio="none"
        aria-hidden
      >
        {channels.map((channel, index) => (
          <path
            key={channel.name}
            className="fan-trail"
            d={fanPath(index)}
            pathLength={1}
          />
        ))}
      </svg>
      <ul className="fan-channels" aria-label="Delivery channels">
        {channels.map((channel, index) => (
          <li key={channel.name}>
            {"src" in channel ? (
              <img src={channel.src} alt="" width={20} height={20} />
            ) : channel.icon === "mail" ? (
              <Mail size={20} aria-hidden />
            ) : (
              <Webhook size={20} aria-hidden />
            )}
            <span>{channel.name}</span>
            <time aria-hidden>21:04:{String(2 + index).padStart(2, "0")}</time>
          </li>
        ))}
      </ul>
    </div>
  );
}
