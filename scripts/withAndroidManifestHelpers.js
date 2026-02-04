const { withAndroidManifest } = require('@expo/config-plugins');

const withAndroidManifestHelpers = (config) => {
    return withAndroidManifest(config, async (config) => {
        const androidManifest = config.modResults;
        const metaDataList = androidManifest.manifest.application[0]['meta-data'];

        if (metaDataList) {
            const notificationColorMetaData = metaDataList.find(
                (metaData) =>
                    metaData['$']['android:name'] ===
                    'com.google.firebase.messaging.default_notification_color'
            );

            if (notificationColorMetaData) {
                if (!notificationColorMetaData['$']['tools:replace']) {
                    notificationColorMetaData['$']['tools:replace'] = 'android:resource';
                } else if (!notificationColorMetaData['$']['tools:replace'].includes('android:resource')) {
                    notificationColorMetaData['$']['tools:replace'] += ',android:resource';
                }
            }
        }

        return config;
    });
};

module.exports = withAndroidManifestHelpers;
