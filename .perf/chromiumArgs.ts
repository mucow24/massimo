/**
 * The launch args BOTH perf playwright configs pass to chromium, shared so the
 * GPU stamp (gpuInfo.ts) probes the same launch it is vouching for — its first
 * version launched a default chromium and reported SwiftShader while the test
 * browser ran hardware, which is precisely the lying-instrument failure the
 * stamp exists to prevent.
 *
 * `--use-angle=d3d11`: Playwright's default headless is FULL software
 * rendering (SwiftShader WebGL, software compositing, software raster). This
 * flag flips all three to hardware on the Intel iGPU — the adapter a headed
 * browser on this machine actually binds — while staying headless. Verified
 * via SystemInfo featureStatus. See README, "the dev machine has two GPUs".
 */
export const PERF_CHROMIUM_ARGS = ['--use-angle=d3d11'];
