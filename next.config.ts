import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 상위 디렉터리의 pnpm-workspace.yaml 을 프로젝트 루트로 오인하지 않도록 고정한다.
  turbopack: { root: __dirname },
  // 개발 서버를 127.0.0.1 / LAN IP 로 열어 확인할 때 정적 청크가 403 되는 것을 막는다.
  allowedDevOrigins: ['127.0.0.1', 'localhost'],
};

export default nextConfig;
