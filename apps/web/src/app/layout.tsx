import './global.css';

export const metadata = {
  title: 'Lattice',
  description: 'Repository knowledge for humans and coding agents.',
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
