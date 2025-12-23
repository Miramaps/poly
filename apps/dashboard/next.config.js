/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ['@poly-trader/shared'],
  experimental: {
    serverActions: true,
  },
};

module.exports = nextConfig;

