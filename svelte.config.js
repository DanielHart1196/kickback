let adapterFactory = null;
try {
  adapterFactory = (await import('@sveltejs/adapter-vercel')).default;
} catch {
  adapterFactory = (await import('@sveltejs/adapter-auto')).default;
}
const config = { kit: { adapter: adapterFactory() } };

export default config;
