import './globals.css';

export const metadata = {
  title: 'GeoWeedo',
  description: 'Guess the dispensary. Own the map.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
