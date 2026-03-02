# react-native-nfc-rw
[![npm version](http://img.shields.io/npm/v/react-native-nfc-rw.svg?style=flat-square)](https://npmjs.org/package/react-native-nfc-rw "View this project on npm")
[![npm downloads](http://img.shields.io/npm/dm/react-native-nfc-rw.svg?style=flat-square)](https://npmjs.org/package/react-native-nfc-rw "View this project on npm")
[![npm licence](http://img.shields.io/npm/l/react-native-nfc-rw.svg?style=flat-square)](https://npmjs.org/package/react-native-nfc-rw "View this project on npm")
[![Platform](https://img.shields.io/badge/platform-ios%20%7C%20android-989898.svg?style=flat-square)](https://npmjs.org/package/react-native-nfc-rw "View this project on npm")

System NFC alert modal can't show on my Android phone, so be this wrapper to easy to use [react-native-nfc-manager](https://github.com/whitedogg13/react-native-nfc-manager) .

For now, this repo only support NfcV read and write as `readNfcVTag` and `writeNfcVTag` .

## Install

`$ npm install --save react-native-nfc-rw react-native-nfc-manager`

### iOS

`cd ios/ && pod install`

In Xcode's `Signing & Capabilities` tab, add `Near Field Communication Tag Reading` in `Capability` , and Xcode will generate `<your-project>.entitlement` file automatically, if `Automatically manage siging` is checked, the Identifier and Profile in `developer.apple.com` will also be modified automatically.

In your `info.plist` , add
```
<key>NFCReaderUsageDescription</key>
<string>We need to use NFC</string>
```

## Usage
```javascript
import React, {Component} from 'react';
import {Button, Modal, StyleSheet, Text, View} from 'react-native';
import {
  destroyNfc,
  initNfc,
  readNfcVTag,
  writeNfcVTag,
} from 'react-native-nfc-rw';

const NFC_YOUR_APP_READ_START_BLOCK = 1;
const NFC_YOUR_APP_WRITE_START_BLOCK = 128;

export default class App extends Component {
  constructor(props) {
    super(props);
    this.state = {
      modalNfc: false,
    };
  }

  alertEnableNfc = () => Alert.alert('Remind', 'Please enable NFC of your phone');

  alertNoNfcSupport = () => Alert.alert('Remind', 'NFC is not supported on your phone');

  alertNfcOther = error => console.error('initNfc: ', error);

  // will be invoked on iOS and Android by a button in render()
  showNfcModal = () => {
    initNfc({
      alertEnableNfc: this.alertEnableNfc,
      alertNoNfcSupport: this.alertNoNfcSupport,
      alertNfcOther: this.alertNfcOther,
      onDiscoverTag: this.onDiscoverTag,
      alertIosMessage: 'Let your phone tap the device to add', // for system NFC alert modal on iOS
      alertAndroidOpen: () => this.setState({modalNfc: true}), // for custom NFC alert modal on Android, cause system NFC alert modal can't show on my Android phone
      alertAndroidClose: destroyNfc, // default is destroyNfc
    });
  };

  // will only be invoked on Android
  dismissNfcModal = () => {
    this.setState({
      modalNfc: false,
    });
  };

  onDiscoverTag = async tag => {
    try {
      let dataRead = await readNfcVTag({
        tag,
        startBlock: NFC_YOUR_APP_READ_START_BLOCK,
        bytesLength: 7, // how many bytes to read from startBlock，default is 4 as one block size
        // forceReadSingleBlock: false, // if true, 4 by 4 bytes when read many bytes，slowest but more compatible
      });

      // ......

      let isOk = await writeNfcVTag({
        tag,
        startBlock: NFC_YOUR_APP_WRITE_START_BLOCK,
        dataToWrite: [1, 9, 4, 9, 10, 1], // bytes array to write from startBlock，if dataToWrite.length % 4 is not 0, will pad 0x00
      });

      if (!isOk) {
        Alert.alert(
          'Write failed',
          'Please tap the device to write NFC',
        );
        return;
      }

    } catch (err) {
      console.error('onDiscoverTag: ', err);
    }
  };

  render() {
    // ......
  }
}
```
