/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ['pdf-parse', '@napi-rs/canvas'],
  async redirects() {
    return [
      {
        source: '/weedo-facts',
        destination: '/geoweedo-facts',
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
