import "./globals.css";
import "./redesign.css";
export const metadata = {
  title: "MS Professor Agent",
  description:
    "Plan thoughtful research outreach, securely share your academic story, and keep every approved conversation on track.",
};
export default function Layout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
