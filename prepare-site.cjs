// Copie uniquement les fichiers publics de l'application, sans SQL ni outils de test.
const fs = require('node:fs');
const path = require('node:path');
const output = path.join(__dirname, 'public');
fs.mkdirSync(output, {recursive: true});
for (const file of ['index.html', 'style.css', 'script.js', 'shops.js', 'shops-core.js']) {
    fs.copyFileSync(path.join(__dirname, file), path.join(output, file));
}
console.log('Les cinq fichiers du site sont prêts.');
