export const revalidate = 604800; // Revalidate every 30 days

import { Skeleton } from "@repo/ui/skeleton";
import { FileDown, Loader2Icon, Mail, MoveRight } from "lucide-react";
import type { Metadata } from "next";
import Image from "next/image";
import { Suspense } from "react";
import { FaGithub, FaInstagram, FaLinkedin } from "react-icons/fa6";
import CurrentAge from "@/components/current-age";
import { FadeInImage } from "@/components/fade-in-image";
import { FeaturedProjectsSection } from "@/components/featured-projects-section";
import { InstagramGridClient } from "@/components/instagram-grid-client";
import { StyledLink } from "@/components/styled-link";
import { Timeline } from "@/components/timeline";
import TimelineTabsContent from "@/components/timeline-tabs-content";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export const metadata: Metadata = {
  title: {
    absolute: "Home | Deniz Lopes Güneş",
  },
  description:
    "Hi, I'm Deniz, a 21 year old software engineer from Portugal. Co-founder and sole developer at Ocean Informatix. Former national-level athlete in handball and American football.",
  openGraph: {
    title: "Home | Deniz Lopes Güneş",
    description:
      "Hi, I'm Deniz, a 21 year old software engineer from Portugal. Co-founder and sole developer at Ocean Informatix.",
    url: "https://denizlg24.com",
    type: "website",
    locale: "en_US",
    siteName: "Deniz Lopes Güneş Portfolio",
  },
  twitter: {
    card: "summary_large_image",
    title: "Home | Deniz Lopes Güneş",
    description:
      "Hi, I'm Deniz, a 21 year old software engineer from Portugal. Co-founder and sole developer at Ocean Informatix.",
  },
};

export default function Home() {
  return (
    <main className="flex flex-col items-center justify-center">
      <section className="w-full max-w-5xl mx-auto px-4 text-center items-center">
        <h1 className="sm:text-5xl text-4xl text-balance font-calistoga text-center">
          hi, deniz here.
        </h1>
        <h2 className="mt-2 whitespace-nowrap text-sm font-medium sm:text-base text-center inline-flex items-center justify-center gap-1">
          <CurrentAge /> yo software engineer from Portugal
          <Image
            loading="eager"
            src="/portugal-flag.svg"
            alt="portugal flag"
            width={600}
            height={400}
            className="w-5 h-auto aspect-[1.5] object-contain rounded"
          />
        </h2>
        <div>
          <code
            className="mt-3 inline-flex items-center rounded-md bg-[#252a25] px-3 py-1.5 text-xs font-mono text-[#d2dcb6] shadow-sm"
            title="Run this in your terminal"
          >
            <span className="text-[#a1bc98] select-none mr-1">$</span>
            ssh me.denizlg24.com
            <span className="ml-1 inline-block w-0.5 h-3.5 bg-[#a1bc98] animate-caret-blink" />
          </code>
        </div>
      </section>
      <section className="w-full max-w-5xl mx-auto px-4 md:grid flex flex-col-reverse grid-cols-5 gap-6 mt-6 items-center">
        <article className="col-span-3 flex flex-col items-start gap-6 w-full">
          <h1 className="sm:text-4xl text-3xl text-balance font-calistoga w-full text-center">
            about me
          </h1>
          <p className="sm:text-base text-sm">
            I&apos;m Deniz, a developer from Portugal with a background shaped
            heavily by competitive sports. Before diving into software, I spent
            years playing handball at a national level and later{" "}
            <StyledLink
              type="anchor"
              href="https://www.zerozero.pt/noticias/-a-minha-cabeca-ficou-saturada-do-andebol-da-selecao-para-o-futebol-americano-/684576"
              target="_blank"
            >
              American Football
            </StyledLink>
            , representing Portugal{" "}
            <StyledLink
              type="anchor"
              href="https://www.zerozero.pt/noticias/sub-20-carlos-martingo-chama-16-atletas-para-o-torneio-4-nacoes/569584"
              target="_blank"
            >
              internationally
            </StyledLink>{" "}
            and even signing to play in Germany. Those experiences taught me
            discipline, focus, and how to handle pressure — qualities that now
            influence the way I approach engineering and problem-solving.
          </p>
          <p className="sm:text-base text-sm">
            I've completed my{" "}
            <strong>
              BSc in Computing and Informatics Engineering at FEUP
            </strong>{" "}
            in 2026. I'm starting my{" "}
            <strong>MSc in Computer Science and Engineering at DTU</strong> in
            Denmark. I specialize in fullstack development, creating web
            applications, but also have developed custom software solutions, and
            modern digital experiences for clients. I enjoy designing systems
            end-to-end, experimenting with new technologies, and building
            products that feel simple, reliable, and are safe to use.
          </p>
        </article>
        <div className="col-span-2 w-full flex flex-col items-center gap-2">
          <div className="rounded-t-full h-auto aspect-[0.8] bg-accent w-full overflow-hidden sm:max-w-2xs max-w-3xs border shadow flex flex-col items-center justify-end group">
            <FadeInImage
              src="/headshot-square.png"
              alt="Deniz profile picture"
              width={512}
              height={512}
              className="w-full h-auto aspect-square object-cover translate-y-2 group-hover:translate-y-0 transition-transform duration-300 drop-shadow-2xl"
            />
          </div>
          <div className="flex justify-between w-full sm:max-w-2xs max-w-3xs gap-4 items-center mx-auto">
            <Button variant={"secondary"} className="w-fit" asChild>
              <a
                href="/assets/DenizGunesCV2026.pdf"
                target="_blank"
                rel="noopener"
              >
                Resume <FileDown />
              </a>
            </Button>
            <a
              href="https://www.linkedin.com/in/deniz-g%C3%BCnes-068509263/"
              className="text-accent hover:text-foreground transition-colors"
              target="_blank"
              rel="noopener noreferrer"
            >
              <FaLinkedin className="w-5 h-5" />
            </a>
            <a
              href="https://github.com/denizlg24"
              className="text-accent hover:text-foreground transition-colors"
              target="_blank"
              rel="noopener noreferrer"
            >
              <FaGithub className="w-5 h-5" />
            </a>
            <a
              href="https://www.instagram.com/denizlg24"
              className="text-accent hover:text-foreground transition-colors"
              target="_blank"
              rel="noopener noreferrer"
            >
              <FaInstagram className="w-5 h-5" />
            </a>
            <a
              href="mailto:denizlgunes@oceaninformatix.com"
              className="text-accent hover:text-foreground transition-colors"
              target="_blank"
              rel="noopener noreferrer"
            >
              <Mail className="w-5 h-5" />
            </a>
          </div>
        </div>
      </section>
      <section className="w-full max-w-5xl mx-auto px-4 flex flex-col gap-6 mt-16">
        <Tabs defaultValue="work" className="w-full">
          <TabsList className="w-full">
            <TabsTrigger value="work">Work</TabsTrigger>
            <TabsTrigger value="education">Education</TabsTrigger>
            <TabsTrigger value="personal">Personal</TabsTrigger>
          </TabsList>
          <TabsContent value="work" className="mt-4">
            <Timeline>
              <Suspense fallback={<Skeleton className="w-full h-[150px]" />}>
                <TimelineTabsContent category="work" />
              </Suspense>
            </Timeline>
          </TabsContent>
          <TabsContent value="education" className="mt-4">
            <Timeline>
              <Suspense fallback={<Skeleton className="w-full h-[150px]" />}>
                <TimelineTabsContent category="education" />
              </Suspense>
            </Timeline>
          </TabsContent>
          <TabsContent value="personal" className="mt-4">
            <Timeline>
              <Suspense fallback={<Skeleton className="w-full h-[150px]" />}>
                <TimelineTabsContent category="personal" />
              </Suspense>
            </Timeline>
          </TabsContent>
        </Tabs>
      </section>
      <section className="w-full max-w-5xl mx-auto px-4 flex flex-col gap-12 mt-16">
        <div className="w-full flex flex-col gap-0.5 items-center">
          <h1 className="sm:text-4xl text-3xl text-balance font-calistoga w-full text-center">
            featured projects
          </h1>
          <StyledLink className="inline-flex gap-1 text-sm" href="/projects">
            View More <MoveRight />
          </StyledLink>
        </div>

        <div className="grid md:grid-cols-3 xs:grid-cols-2 grid-cols-1 gap-4">
          <Suspense
            fallback={
              <div className="col-span-full h-[150px] flex items-center justify-center">
                <Loader2Icon className="w-4 h-4 animate-spin" />
              </div>
            }
          >
            <FeaturedProjectsSection count={3} />
          </Suspense>
        </div>
      </section>
      <section className="w-full max-w-5xl px-4 mx-auto flex flex-col gap-12 mt-16">
        <div className="w-full flex flex-col gap-0.5 items-center">
          <h1 className="sm:text-4xl text-3xl text-balance font-calistoga w-full text-center">
            outside the computer
          </h1>
          <a
            href="https://www.instagram.com/denizlg24"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex gap-1 text-sm text-accent hover:text-foreground transition-colors items-center"
          >
            @denizlg24
          </a>
        </div>

        <div className="grid grid-cols-4 xs:gap-3 gap-1 auto-rows-[120px] sm:auto-rows-[140px]">
          <InstagramGridClient count={7} />
        </div>
      </section>
    </main>
  );
}
