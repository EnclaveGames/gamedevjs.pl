const webpack = require('webpack');
const merge = require('webpack-merge');
const common = require('./common.js');

const UglifyJSPlugin = require('uglifyjs-webpack-plugin');
const SWPrecacheWebpackPlugin = require('sw-precache-webpack-plugin');
import CleanWebpackPlugin from 'clean-webpack-plugin';
import ScriptExtHtmlWebpackPlugin from "script-ext-html-webpack-plugin";
const BundleAnalyzerPlugin = require('webpack-bundle-analyzer').BundleAnalyzerPlugin;

import paths from './paths';

module.exports = merge(common, {
    devtool: 'source-map',
    plugins: [
        new CleanWebpackPlugin([
            paths.dst + '/' + paths.es,
            paths.dst + '/' + paths.css
        ], {
            allowExternal: true
        }),

        new webpack.DefinePlugin({
            'process.env': {
                'NODE_ENV': JSON.stringify('production')
            }
        }),

        new webpack.optimize.CommonsChunkPlugin({
            name: 'client',
        }),

        new webpack.optimize.CommonsChunkPlugin({
            name: 'client',
            async: true
        }),

        new webpack.optimize.CommonsChunkPlugin({
            name: 'vendor',
            minChunks(module, count) {
                return module.context && module.context.indexOf("node_modules") !== -1;
            },
        }),

        new webpack.optimize.CommonsChunkPlugin({
            name: 'vendor',
            minChunks(module, count) {
                return module.context && module.context.indexOf("node_modules") !== -1;
            },
            async: true
        }),

        new webpack.optimize.CommonsChunkPlugin({
            name: 'manifest',
            minChunks: Infinity
        }),

        new webpack.optimize.ModuleConcatenationPlugin(),
        new UglifyJSPlugin({
            sourceMap: true,
            uglifyOptions: {
                warnings: false,
                ie8: false,
                ecma: 8
            }
        }),

        new ScriptExtHtmlWebpackPlugin({
            preload: ['vendor', 'client'],
        }),

        new SWPrecacheWebpackPlugin({
            cacheId: 'gamedevjs.pl-static',
            filename: 'sw-precache-static.js',
            importScripts: [
                'sw-precache-static-ext.js'
            ],
            staticFileGlobs: [
                'dist/js/**/*.{js}',
                'dist/css/**/*.{css}',
                'dist/img/client/**/*.{svg,png,jpg,gif}',
                'dist/fonts/**/*.{woff2}'
            ],
            minify: true,
            stripPrefix: 'dist/',
            mergeStaticsConfig: true,
            staticFileGlobsIgnorePatterns: [/\.map$/],
        }),

        new BundleAnalyzerPlugin({
            analyzerMode: 'static',
            reportFilename: '../build/report.html',
        }),
    ]
});