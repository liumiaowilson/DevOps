const fs = require('fs');
const { exec } = require('child_process');

const [,,RootDir, pattern, newState] = process.argv;

console.log('Pattern: ', pattern);
console.log('New State: ', newState);

exec('sfdx force:org:display', (error, stdout, stderr) => {
    if(error) {
        console.log(error.message);
    }
    if(stderr) {
        console.log(stderr);
    }
    const lines = stdout.split('\n');
    const [,username] = lines.find(line => line.startsWith('Username')).split(/\s+/);
    const sourcePathInfosFile = `${RootDir}/.sfdx/orgs/${username}/sourcePathInfos.json`;
    const json = JSON.parse(fs.readFileSync(sourcePathInfosFile, 'utf8'));

    Object.keys(json).forEach(key => {
        if(key.includes(pattern)) {
            json[key].state = newState;
        }
    });

    const content = JSON.stringify(json, null, 4);
    fs.writeFileSync(sourcePathInfosFile, content);
});
