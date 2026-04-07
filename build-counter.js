const fs = require('fs');
const path = require('path');

const buildFile = path.join(__dirname, '.buildcount');

// Read current build count
let buildCount = 0;
if (fs.existsSync(buildFile)) {
  buildCount = parseInt(fs.readFileSync(buildFile, 'utf8').trim() || '0', 10);
}

// Increment and save
buildCount++;
fs.writeFileSync(buildFile, buildCount.toString());

console.log(`📦 Build #${buildCount}`);
process.exit(0);
