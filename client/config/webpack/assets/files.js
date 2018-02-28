const isDebug = process.env.NODE_ENV !== 'production';

import paths from '../paths'

module.exports = {
    rules: [
        {
            test: /\.(svg)$/,
            use: 'raw-loader'
        },
        {
            test: /\.(png|gif|jpg)$/i,
            use: [
                {
                    // Falls back to file-loader when the file size is above the threshold.
                    loader: 'url-loader',
                    options: {
                        limit: 8192,
                        outputPath: paths.img,
                        name (file) {
                            if (isDebug) {
                                return '[path][name].[ext]'
                            }

                            return '[hash].[ext]'
                        }
                    },
                },
            ],
        },
    ]
};