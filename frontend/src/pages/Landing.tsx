import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import Navbar from "../components/Navbar";
import About from "../sections/About";
import AiDemo from "../sections/AiDemo";
import Architecture from "../sections/Architecture";
import Hero from "../sections/Hero";
import HowItWorks from "../sections/HowItWorks";
import MapSection from "../sections/MapSection";
import Modes from "../sections/Modes";
import Problem from "../sections/Problem";

export default function Landing() {
  const { hash } = useLocation();
  useEffect(() => {
    if (!hash) return;
    const id = setTimeout(() => document.getElementById(hash.slice(1))?.scrollIntoView({ behavior: "smooth" }), 50);
    return () => clearTimeout(id);
  }, [hash]);

  return (
    <>
      <Navbar />
      <main>
        <Hero />
        <Problem />
        <HowItWorks />
        <AiDemo />
        <MapSection />
        <Architecture />
        <Modes />
        <About />
      </main>
    </>
  );
}
