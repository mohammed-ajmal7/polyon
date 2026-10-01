import dynamic from "next/dynamic";

const CommandPageClient = dynamic(() => import("./command-page-client"), {
  ssr: false,
});

export default function CommandPage() {
  return <CommandPageClient />;
}
