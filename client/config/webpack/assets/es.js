import paths from '../paths'

const isDebug = process.env.NODE_ENV !== 'production';
// const pkg = require(paths.root + '/package.json');

module.exports = {
    rules: [
        {
            test: /\.jsx?$/,
            include: paths.src,
            use: [
                {
                    loader: 'babel-loader',
                    options: {
                        cacheDirectory: isDebug,
                        presets: [
                            [
                                '@babel/env', {
                                /*
                                targets: {
                                    browsers: pkg.browserslist,
                                },
                                */
                                useBuiltIns: 'usage',
                                exclude: [
                                    '@babel/plugin-transform-regenerator', 'transform-regenerator'
                                ]
                            },
                            ],
                            'stage-2',
                            'react',
                        ],
                        plugins: [
                            'transform-class-properties',
                            'transform-decorators-legacy',
                            // 'transform-decorators'
                        ]
                    },
                }
            ],
        },
    ]
};