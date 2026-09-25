/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: '**' },
    ],
  },
  experimental: {
    // Keep heavy Node-only SDKs external to the server bundle. Without this,
    // Next 14's webpack tries to bundle their ESM builds and mis-resolves
    // internal named exports (e.g. Stripe's './utils.js' exports).
    serverComponentsExternalPackages: [
      'stripe',
      'mongoose',
      '@react-pdf/renderer',
      'cloudinary',
    ],
  },
};

export default nextConfig;
