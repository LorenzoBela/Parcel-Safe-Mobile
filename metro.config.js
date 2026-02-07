const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const config = getDefaultConfig(__dirname);

// If running from the editing directory, also watch the build directory
const BUILD_DIR = 'C:\\Dev\\TopBox\\mobile';
if (
    path.resolve(__dirname) !== path.resolve(BUILD_DIR) &&
    require('fs').existsSync(BUILD_DIR)
) {
    config.watchFolders = [
        ...(config.watchFolders || []),
        path.resolve(BUILD_DIR),
    ];
}

// Transformer: inline requires for faster startup
config.transformer = {
    ...config.transformer,
    getTransformOptions: async () => ({
        transform: {
            experimentalImportSupport: false,
            inlineRequires: true,
        },
    }),
};

// Resolver: add extra asset extensions only
config.resolver = {
    ...config.resolver,
    assetExts: [...(config.resolver.assetExts || []), 'db', 'mp3', 'obj'],
};

// Server: CORS for dev client
config.server = {
    ...config.server,
    port: 8081,
    enhanceMiddleware: (middleware) => {
        return (req, res, next) => {
            res.setHeader('Access-Control-Allow-Origin', '*');
            return middleware(req, res, next);
        };
    },
};

config.maxWorkers = 4;

module.exports = config;
