import "../styles/globals.css";

export const metadata = {
  title: "Infinite Stories",
  description: "Procedurally generated short-form feed (local LLM via Ollama)",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="container">{children}</div>
      </body>
    </html>
  );
}
