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

function getPropertyNames(descriptor) {
    return window.$A.componentService.$moduleDefRegistry$[descriptor]?.ad?.map(a => a[0]);
}

const [ namespace, tagName ] = getQualifiedName($0);
const descriptor = tagNameToDescriptor(tagName);
const propertyNames = getPropertyNames(descriptor);

const params = {};
try {
    for(const propertyName of propertyNames) {
        const value = $0[propertyName];
        if(value != null && value !== false) {
            params[propertyName] = $0[propertyName];
        }
    }
}
catch(e) {
}

console.clear();
const style = 'background-color: darkblue; color: white; font-style: italic; border: 2px solid white; border-radius: 4px; font-size: 1.5em;'
console.log('%c ' + tagName, style);
console.log('Component Name: ', tagName);
console.log('Component Params: %O', params);
