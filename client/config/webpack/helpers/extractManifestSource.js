const getAssetKind = require('assets-webpack-plugin/lib/getAssetKind');
const isHMRUpdate = require('assets-webpack-plugin/lib/isHMRUpdate');
const isSourceMap = require('assets-webpack-plugin/lib/isSourceMap');

module.exports = function(compilation) {
  const options = compilation.options;
  const stats = compilation.getStats().toJson({
    hash: true,
    publicPath: true,
    assets: true,
    chunks: false,
    modules: false,
    source: false,
    errorDetails: false,
    timings: false
  })

  const assetPath = stats.publicPath || '';
  const assetsByChunkName = stats.assetsByChunkName;

  const output = Object.keys(assetsByChunkName).reduce(function (chunkMap, chunkName) {
    let assets = assetsByChunkName[chunkName];
    if (!Array.isArray(assets)) {
      assets = [assets]
    }

    chunkMap[chunkName] = assets.reduce(function (typeMap, asset) {
      if (isHMRUpdate(options, asset) || isSourceMap(options, asset)) {
        return typeMap
      }

      let typeName = getAssetKind(options, asset);
      typeMap[typeName] = assetPath + asset;

      return typeMap
    }, {});

    return chunkMap
  }, {});

  const manifestEntry = output['manifest'];
  if (manifestEntry) {
    const manifestAssetKey = manifestEntry.js.substr(assetPath.length);
    const parentSrc = compilation.assets[manifestAssetKey];
    const entryText = parentSrc.source();
    if (!entryText) {
      throw new Error('Failed to locate manifest function', parentSrc)
    }

    return entryText
  }
};
