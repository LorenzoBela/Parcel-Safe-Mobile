const { withProjectBuildGradle } = require('expo/config-plugins');

module.exports = function withAndroidKotlin(config) {
    return withProjectBuildGradle(config, (config) => {
        if (config.modResults.language === 'groovy') {
            config.modResults.contents = config.modResults.contents.replace(
                /classpath\('org.jetbrains.kotlin:kotlin-gradle-plugin'\)/g,
                `classpath('org.jetbrains.kotlin:kotlin-gradle-plugin:2.0.21')`
            );
        }
        return config;
    });
};
