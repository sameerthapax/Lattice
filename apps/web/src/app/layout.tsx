import './global.css';

export const metadata = {
  title: 'Lattice Graph Explorer',
  description: 'Inspect deterministic repository structure and dependencies.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
