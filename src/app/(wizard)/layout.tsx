import { WizardProgress } from "@/components/layout/WizardProgress";

export default function WizardLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <WizardProgress />
      <main id="main" className="site-main wizard-main">
        {children}
      </main>
    </>
  );
}
