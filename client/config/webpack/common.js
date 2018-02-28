import webpack from 'webpack';
import HtmlWebpackPlugin from 'html-webpack-plugin';

import paths from './paths'
import es from './assets/es'
import styles from './assets/styles'
import files from './assets/files'
import config from '../../config'

const isDebug = process.env.NODE_ENV !== 'production';

module.exports = {
    name: 'client',
    target: 'web',

    entry: {
        // Note: No babel-polyfill as first entry point.
        client: ['./src/client.js']
    },

    resolve: {
        modules: ['node_modules', 'src'],
    },

    module: {
        rules: [
            ...es.rules,
            ...styles.rules,
            ...files.rules
        ]
    },

    plugins: [
        ...styles.plugins,

        new HtmlWebpackPlugin({
            // We are going to inline the manifest, so we don't want it to be loaded twice.
            excludeChunks: ['manifest'],
            template: './src/index.html.js',
            filename: 'index.html',
            inject: 'body',
            chunksSortMode: 'dependency',

            minify: {
                html5: true,
                useShortDoctype: true,
                decodeEntities: true,
                removeStyleLinkTypeAttributes: true,
                removeScriptTypeAttributes: true,
                minifyCSS: true,
                minifyJS: true,
                removeComments: true,
                collapseWhitespace: true,
                collapseBooleanAttributes: true,
                removeAttributeQuotes: true,
                removeRedundantAttributes: true,
                removeEmptyAttributes: true,
                preserveLineBreaks: false,
                sortAttributes: true,
                sortClassName: true
            },

            bootstrap: JSON.stringify(config.bootstrap),
        }),

        new webpack.NamedModulesPlugin(),
    ],

    output: {
        path: paths.dst,
        publicPath: '/',
        filename: isDebug ? paths.es + '[name].js' : paths.es + '[name].[chunkhash:6].js',
        chunkFilename: isDebug
            ? paths.es + '[name].chunk.js'
            : paths.es + '[name].[chunkhash:6].chunk.js'
    },

    node: {
        fs: 'empty',
        net: 'empty',
        tls: 'empty',
    },
};