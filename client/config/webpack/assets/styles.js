import ExtractTextPlugin from 'extract-text-webpack-plugin';

import paths from '../paths'

const isDebug = process.env.NODE_ENV !== 'production';
const extractMasterSass = new ExtractTextPlugin({
    filename: paths.css + 'master.[contenthash:6].css',
});

const genCommonLoaderConfigs = (useModules) => {
    return [
        {
            loader: 'css-loader',
            options: {
                importLoaders: useModules ? 3 : 2,
                sourceMap: isDebug,
                minimize: true,
                discardComments: {
                    removeAll: true
                },
               ...(useModules ? {
                       modules: true,
                       localIdentName: isDebug
                           ? '[name]-[local]-[hash:base64:5]'
                           : '[hash:base64:5]',
                   } : {}
                )
            }
        },
        {
            loader: 'postcss-loader',
            options: {
                plugins: (loader) => [
                    require('autoprefixer')(),
                    require('css-mqpacker')(),
                ]
            }
        },
        {
            loader: 'sass-loader',
            options: {
                sourceMaps: isDebug
            }
        }
    ]
};

module.exports = {
    plugins: [
        extractMasterSass
    ],
    rules: [
        {
            test: /\.s[ac]ss$/,
            include: /styles/,
            use: extractMasterSass.extract({
                fallback: 'style-loader',
                allChunks: true,
                use: genCommonLoaderConfigs(false),
            }),
        },
        {
            test: /\.s[ac]ss$/,
            exclude: /styles/,
            use: extractMasterSass.extract({
                fallback: 'style-loader',
                allChunks: true,
                use: [
                    ...genCommonLoaderConfigs(true),
                    {
                        loader: 'sass-resources-loader',
                        options: {
                            resources: ['./src/styles/_config.sass']
                        },
                    },
                ],
            }),
        }
    ]
};