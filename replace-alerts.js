const fs = require('fs');
const path = require('path');

function findFiles(dir, filter, fileList = []) {
    const files = fs.readdirSync(dir);
    for (const file of files) {
        const filePath = path.join(dir, file);
        if (fs.statSync(filePath).isDirectory()) {
            findFiles(filePath, filter, fileList);
        } else if (filter.test(filePath)) {
            fileList.push(filePath);
        }
    }
    return fileList;
}

const srcDir = path.join(__dirname, 'src');
const files = findFiles(srcDir, /\.(ts|tsx)$/);

let changedFiles = 0;

for (const file of files) {
    let content = fs.readFileSync(file, 'utf8');
    let originalContent = content;

    // Skip the PremiumAlertService itself and GlobalPremiumAlert
    if (file.includes('PremiumAlertService') || file.includes('GlobalPremiumAlert')) continue;

    // Replace Alert.alert
    if (content.includes('Alert.alert')) {
        content = content.replace(/Alert\.alert/g, 'PremiumAlert.alert');

        // Add PremiumAlert import
        const depth = file.split(path.sep).length - srcDir.split(path.sep).length;
        let importPath = '';
        if (depth === 1) importPath = './services/PremiumAlertService';
        else importPath = '../'.repeat(depth - 1) + 'services/PremiumAlertService';

        // Check if import already exists
        if (!content.includes('PremiumAlertService')) {
            // Find the last import
            const importMatches = [...content.matchAll(/^import.*$/gm)];
            if (importMatches.length > 0) {
                const lastImportIndex = importMatches[importMatches.length - 1].index + importMatches[importMatches.length - 1][0].length;
                content = content.slice(0, lastImportIndex) + `\nimport { PremiumAlert } from '${importPath}';` + content.slice(lastImportIndex);
            } else {
                content = `import { PremiumAlert } from '${importPath}';\n` + content;
            }
        }
    }

    // Check if Native Alert is still needed (like AlertButton type or something else)
    // If `Alert` import from react-native is no longer used, remove it from the destructured import
    if (content.includes('import {') && content.includes('react-native') && content.includes('Alert')) {
        // If Alert is the only thing, it could be tricky. 
        // Let's just blindly remove 'Alert, ' or 'Alert' from the react native import line if it's there
        // Actually, safer regex: Look for `import { ... Alert ... } from 'react-native'`
        if (!content.includes('Alert.') || content.includes('import { Alert }')) { // Basic heuristic
            content = content.replace(/import\s+{\s*Alert\s*}\s+from\s+['"]react-native['"];?\n?/, '');
            content = content.replace(/,\s*Alert\b|\bAlert,\s*/g, '');
        }
    }

    if (content !== originalContent) {
        fs.writeFileSync(file, content, 'utf8');
        changedFiles++;
        console.log(`Updated: ${file.replace(__dirname, '')}`);
    }
}

console.log(`\nSuccessfully updated ${changedFiles} files with PremiumAlert.`);
