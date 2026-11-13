/** @type {import('next').NextConfig} */
const nextConfig = {
  // The embedding model runs on the server through onnxruntime-node (native code).
  serverExternalPackages: ["@huggingface/transformers", "onnxruntime-node", "sharp"],
};
export default nextConfig;
