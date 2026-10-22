const fs = require('fs');
const { execSync } = require('child_process');

// Save original config
const originalConfig = fs.readFileSync('next.config.ts', 'utf8');

// Set the environment variable for this process and child processes
process.env.GITHUB_PAGES_BUILD = 'true';

// Copy the GitHub Pages config
fs.copyFileSync('next.config.github.ts', 'next.config.ts');
console.log('Copied next.config.github.ts to next.config.ts');

// Run the build
try {
  execSync('npm run build', { stdio: 'inherit', env: process.env });
  console.log('GitHub Pages build completed successfully');
} catch (error) {
  console.error('GitHub Pages build failed');
  // Restore original config even on failure
  fs.writeFileSync('next.config.ts', originalConfig);
  process.exit(1);
}

// Restore original config
fs.writeFileSync('next.config.ts', originalConfig);
console.log('Restored original next.config.ts');