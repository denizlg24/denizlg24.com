import { ApiStatusComponent } from "./_components/api-status-component";
import { GettingStartedSection } from "./_components/getting-started-section";
import { HeroSection } from "./_components/hero-section";

export default function Home() {
  return (
    <main className="w-full">
      <HeroSection />
      <GettingStartedSection />
      <ApiStatusComponent />
    </main>
  );
}
