const showAll = false;

function getQualifiedName(element) {
    let tagName = element.tagName.toLowerCase();
    let ns = tagName.split('-')[0];
    if(ns === 'c') {
        if(Aura.initConfig.context.dns) {
            ns = Aura.initConfig.context.dns;
        }
    }

    if(tagName.startsWith('c-')) {
        tagName = ns + '-' + tagName.substring(2);
    }

    return [ ns, tagName ];
}

function tagNameToDescriptor(tagName) {
    let result = 'markup://';
    const items = tagName.split('-');
    result += items[0] + ':';
    for(let i = 1; i < items.length; i++) {
        result += (i === 1 ? items[i] : items[i][0].toUpperCase() + items[i].substring(1));
    }

    return result;
}

function moduleToDescriptor(module) {
    let result = 'markup://';
    const items = module.split('/');
    result += items[0] + ':' + items[1];

    return result;
}

const ignoredModules = [
    'lwc',
    'exports',
];

function listDescriptor(descriptor, namespace, modules = []) {
    const moduleName = descriptor.substring('markup://'.length);
    if(!moduleName.startsWith('lightning:') && !modules.includes(moduleName)) {
        modules.push(moduleName);
    }

    const module = window.$A.componentService.$moduleDefRegistry$[descriptor];
    if(!module) {
        throw new Error('Invalid descriptor: ' + descriptor);
    }

    const dependencies = module.dp;
    const result = {};
    for(const dep of dependencies) {
        if(ignoredModules.includes(dep)) {
            continue;
        }

        if(dep.startsWith('@salesforce/') || !dep.includes('/')) {
            result[dep] = '';
        }
        else {
            const [ ns, ] = dep.split('/');
            if(ns === namespace || showAll) {
                result[dep] = listDescriptor(moduleToDescriptor(dep), namespace, modules);
            }
            else {
                result[dep] = '';
            }
        }
    }

    return result;
}

const [ namespace, tagName ] = getQualifiedName($0);
console.log(namespace);
console.log(tagName);
const descriptor = tagNameToDescriptor(tagName);

const moduleNames = [];
const componentTree = listDescriptor(descriptor, namespace, moduleNames);

console.clear();
const style = 'background-color: darkblue; color: white; font-style: italic; border: 2px solid white; border-radius: 4px; font-size: 1.5em;'
console.log('%c ' + tagName, style);
console.log('Component Tree: %O', componentTree);
moduleNames.sort();
console.log('Included Modules: %O', moduleNames);
