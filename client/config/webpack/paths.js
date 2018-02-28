import path from 'path';

const rootDir = path.resolve(__dirname, '../..');

module.exports = {
    root: rootDir,
    src: path.resolve(rootDir, 'src'),
    dst: path.resolve(rootDir, 'dist'),

    // Output paths (prefixes to file names).
    es: 'js/',
    css: 'css/',
    img: 'img/client/'
};