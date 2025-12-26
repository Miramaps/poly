/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  env: {
    NEXT_PUBLIC_API_URL: 'http://18.175.223.104:3001',
    NEXT_PUBLIC_WS_URL: 'ws://18.175.223.104:3001'
  }
}

module.exports = nextConfig
