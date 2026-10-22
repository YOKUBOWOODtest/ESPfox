const fs = require('fs');
fs.copyFileSync('next.config.github.ts', 'next.config.ts');
console.log('Copied next.config.github.ts to next.config.ts');