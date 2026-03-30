import {Platform} from 'react-native';
import NfcManager, {NfcEvents, NfcTech, Ndef} from 'react-native-nfc-manager';

// AI said
// flags: 0x20 表示“高密度”模式（适用于大多数现代 ISO15693 标签）
// 如果读取失败，尝试 flags: 0x04（只读）或 0x00
// 具体 flags 取决于标签芯片（如 TI Tag-it HF-I、NXP ICODE SLIX 等）
// ISO/IEC 15693（也称为 NFC-V）中，Flag 字段用于指定命令的属性，如地址
// 模式、子载波、数据速率等。Flag 字节的具体定义如下：
// 1. 地址模式（位 0）
// * 0：非地址模式（广播，不指定特定标签）
// * 1：地址模式（需要指定标签的 UID）
//
// 2. 选项（位 1）
// * 0：无选项
// * 1：启用选项（如防碰撞）
//
// 3. 数据速率（位 2）
// * 0：低速（1/4 = 6.62 kbps）
// * 1：高速（1/256 = 26.48 kbps）
//
// 4. 子载波（位 3）
// * 0：单子载波
// * 1：双子载波
//
// 5. 保留位（位 4-7）
// * 通常设置为 0
//
// but 复旦微电子的人 said this AI answer is wrong, should be
const NFC_V_CMD_FLAG_BROADCAST = 0x02; // 广播
const NFC_V_CMD_FLAG_ADDRESSED = 0x22; // 指定标签的 UID
const NFC_V_CMD_FLAG_IS_ADDRESSED = 0x20;

function isAddressed(cmdFlag) {
  return (
    (cmdFlag & NFC_V_CMD_FLAG_IS_ADDRESSED) === NFC_V_CMD_FLAG_IS_ADDRESSED
  );
}

const nfcVCmd = {
  READ_SINGLE_BLOCK: 0x20, // read 1 block (4 bytes)
  WRITE_SINGLE_BLOCK: 0x21, // write 1 block (4 bytes)
  LOCK_BLOCK: 0x22, // 锁定块
  READ_MULTIPLE_BLOCKS: 0x23, // 读取多个块的数据
  WRITE_MULTIPLE_BLOCKS: 0x24, // 写入多个块的数据（需标签支持）
  SET_SELECT: 0x25, // 手机可以以此来表示霸占了 NFC 的读写，这样硬件管脚相连的固件就知道此时不能读写了，手机离开后能自动取消霸占的
  READ_REG: 0xae, // 读取寄存器
  WRITE_4_BLOCKS: 0xd6, // write 4 blocks (16 bytes), need tag support
};

function chunk(array, size = 1) {
  if (!array || array.length === 0) return [];
  size = Math.max(1, Math.floor(size));

  const result = [];
  for (let i = 0; i < array.length; i += size) {
    result.push(array.slice(i, i + size));
  }
  return result;
}

function padHexString(string) {
  if (string.length === 1) {
    return '0' + string;
  } else {
    return string;
  }
}

function hexString2ByteArray(string) {
  let array = [];
  [].map.call(string, (value, index, str) => {
    if (index % 2 === 0) {
      array.push(parseInt(value + str[index + 1], 16));
    }
  });

  return array;
}

function byteArray2HexString(bytes) {
  return bytes
    .map(byte => padHexString((byte & 0xff).toString(16)))
    .toString()
    .replace(/,/g, '')
    .toUpperCase();
}

function arraysEqual(a, b) {
  return a.length === b.length && a.every((val, i) => val === b[i]);
}

async function initNfc({
  alertEnableNfc = () => {},
  alertNoNfcSupport = () => {},
  alertNfcOther = () => {},
  onDiscoverTag,
  alertIosMessage = 'Please tap NFC tags', // for system NFC alert modal on iOS
  alertAndroidOpen = () => {}, // for custom NFC alert modal on Android, cause system NFC alert modal can't show on my Android phone
  alertAndroidClose = destroyNfc,
}) {
  try {
    const deviceIsSupported = await NfcManager.isSupported();

    const nfcIsEnabled = await NfcManager.isEnabled();
    if (!nfcIsEnabled) {
      alertEnableNfc();
      return;
    }

    if (deviceIsSupported) {
      await NfcManager.start();
      // console.log('NFC manager started');

      if (Platform.OS === 'ios') {
        try {
          await NfcManager.requestTechnology(NfcTech.NfcV, {
            alertMessage: alertIosMessage,
          });

          const tag = await NfcManager.getTag();
          // console.log('tag found on iOS', tag);
          // tag.id read on iOS is inverted against on Android
          tag.id = byteArray2HexString(hexString2ByteArray(tag.id).reverse());
          // console.log('tag found', tag);

          await onDiscoverTag(tag);
        } catch (err) {
          if (err.message) {
            console.warn('initNfc: ' + err.message);
          }
        } finally {
          NfcManager.cancelTechnologyRequest().catch(() => 0);
        }
      } else {
        alertAndroidOpen();

        NfcManager.setEventListener(NfcEvents.DiscoverTag, async tag => {
          // console.log('tag found on Android', tag);
          // console.log('tag found', tag);

          try {
            await onDiscoverTag(tag);
          } catch (err) {
            if (err.message) {
              console.warn('initNfc: ' + err.message);
            }
          } finally {
            alertAndroidClose();
          }
        });

        await NfcManager.registerTagEvent();
      }
    } else {
      alertNoNfcSupport();
      return;
    }
  } catch (error) {
    alertNfcOther();
  }
}

function destroyNfc() {
  NfcManager.cancelTechnologyRequest().catch(() => 0);
  NfcManager.setEventListener(NfcEvents.DiscoverTag, null);
  // NfcManager.setEventListener(NfcEvents.SessionClosed, null);

  if (Platform.OS === 'android') {
    NfcManager.close();
  }
}

async function setSelectNfcVTag({tag, cmdFlag = NFC_V_CMD_FLAG_ADDRESSED}) {
  let isSet = false;

  try {
    if (Platform.OS === 'android') {
      // NfcManager.requestTechnology(NfcTech.NfcV, {
      //   alertMessage: '请将 NFC-V 标签靠近设备',
      // });
      // 我的 Android 手机上面的代码会导致第一次触碰会死等在这里，然后第二次触碰 NFC 才能读取数据，因此使用下面的代码
      await NfcManager.connect([NfcTech.NfcV]);
    }

    const uid = hexString2ByteArray(tag.id);
    let bytes = await NfcManager.nfcVHandler.transceive([
      cmdFlag | NFC_V_CMD_FLAG_IS_ADDRESSED,
      nfcVCmd.SET_SELECT,
      ...uid,
    ]);

    const response = bytes.shift();
    if (response) {
      console.error('setSelectNfcVTag error:', [response, ...bytes]);
    } else {
      isSet = true;
    }
  } catch (error) {
    console.error('setSelectNfcVTag failed:', error);
  } finally {
    if (Platform.OS === 'android') {
      // 5. 释放 NFC 资源
      NfcManager.cancelTechnologyRequest().catch(err => console.error(err));
      // 如果想要能再次碰触后读取的，就要用上面，否则用下面的
      // NfcManager.close();
    }
  }

  return isSet;
}

// read a reg in NfcV Tag
async function readRegNfcVTag({
  regAddress,
  tag,
  cmdFlag = NFC_V_CMD_FLAG_ADDRESSED,
  icMfgCode, // if not set, will be uid[6] automatically
}) {
  let bytes; // may return bytes of 4 regs start from regAddress

  try {
    if (Platform.OS === 'android') {
      // NfcManager.requestTechnology(NfcTech.NfcV, {
      //   alertMessage: '请将 NFC-V 标签靠近设备',
      // });
      // 我的 Android 手机上面的代码会导致第一次触碰会死等在这里，然后第二次触碰 NFC 才能读取数据，因此使用下面的代码
      await NfcManager.connect([NfcTech.NfcV]);
    }

    if (tag && isAddressed(cmdFlag)) {
      const uid = hexString2ByteArray(tag.id);
      bytes = await NfcManager.nfcVHandler.transceive([
        cmdFlag,
        nfcVCmd.READ_REG,
        icMfgCode || uid[6],
        ...uid,
        regAddress,
      ]);
    } else {
      bytes = await NfcManager.nfcVHandler.transceive([
        cmdFlag,
        nfcVCmd.READ_REG,
        icMfgCode,
        regAddress,
      ]);
    }

    const response = bytes.shift();
    if (response) {
      console.error('readRegNfcVTag error:', [response, ...bytes]);
      return;
    } else {
      return bytes; // 这里 return 了，后面的 finally 仍然会被执行的
    }
  } catch (error) {
    console.error('readRegNfcVTag failed:', error);
  } finally {
    if (Platform.OS === 'android') {
      // 5. 释放 NFC 资源
      NfcManager.cancelTechnologyRequest().catch(err => console.error(err));
      // 如果想要能再次碰触后读取的，就要用上面，否则用下面的
      // NfcManager.close();
    }
  }
}

// automatically use one or more single block or multiple blocks read commands to read
async function readNfcVTagCanMultiple({
  uid,
  cmdFlag = NFC_V_CMD_FLAG_ADDRESSED,
  startBlock = 0,
  bytesLength = 4, // 从 startBlock 开始读取多少个字节，默认为 4 也就是一个 block 的大小
  forceReadSingleBlock = false, // 当读取很多字节时也 4 个字节 4 个字节的读，速度最慢，兼容性好
}) {
  // 复旦微电子的芯片的多块读取命令一次不能超过 224 字节
  const readMultipleMaxBytes = 220;

  if (bytesLength === 4) {
    // 使用一条单块读取命令单次读取，只能读取 4 字节
    return (
      await NfcManager.nfcVHandler.transceive(
        isAddressed(cmdFlag)
          ? [cmdFlag, nfcVCmd.READ_SINGLE_BLOCK, ...uid, startBlock]
          : [cmdFlag, nfcVCmd.READ_SINGLE_BLOCK, startBlock],
      )
    ).slice(1, bytesLength + 1);
  } else if (bytesLength <= readMultipleMaxBytes && bytesLength % 4 === 0) {
    // 使用一条多块读取命令单次读取
    const sameLengthDummyBytes = new Array(bytesLength);
    const blocks = chunk(sameLengthDummyBytes, 4);

    if (forceReadSingleBlock) {
      // 使用多条单块读取命令循环读取
      let bytesRead = [];
      for (let i = 0; i < blocks.length; i++) {
        const block = await NfcManager.nfcVHandler.transceive(
          isAddressed(cmdFlag)
            ? [cmdFlag, nfcVCmd.READ_SINGLE_BLOCK, ...uid, startBlock + i]
            : [cmdFlag, nfcVCmd.READ_SINGLE_BLOCK, startBlock + i],
        );
        bytesRead.push(...block.slice(1, block.length + 1));
      }

      const lastBlockLength = bytesLength % 4;
      if (lastBlockLength) {
        bytesRead = bytesRead.slice(0, lastBlockLength - 4);
      }

      return bytesRead;
    } else {
      return (
        await NfcManager.nfcVHandler.transceive(
          isAddressed(cmdFlag)
            ? [
                cmdFlag,
                nfcVCmd.READ_MULTIPLE_BLOCKS,
                ...uid,
                startBlock,
                blocks.length,
              ]
            : [cmdFlag, nfcVCmd.READ_MULTIPLE_BLOCKS, startBlock, blocks.length],
        )
      ).slice(1, bytesLength + 1);
    }
  } else {
    const sameLengthDummyBytes = new Array(bytesLength);

    if (forceReadSingleBlock) {
      // 使用多条单块读取命令循环读取
      // console.time('READ_SINGLE_BLOCK');
      const blocks = chunk(sameLengthDummyBytes, 4);
      let bytesRead = [];
      for (let i = 0; i < blocks.length; i++) {
        const block = await NfcManager.nfcVHandler.transceive(
          isAddressed(cmdFlag)
            ? [cmdFlag, nfcVCmd.READ_SINGLE_BLOCK, ...uid, startBlock + i]
            : [cmdFlag, nfcVCmd.READ_SINGLE_BLOCK, startBlock + i],
        );
        bytesRead.push(...block.slice(1, block.length + 1));
      }
      // console.timeEnd('READ_SINGLE_BLOCK');
      // 200 bytes:  723.492920 ms
      // 400 bytes:  1189.818115 ms
      // 600 bytes:  2319.375977 ms

      const lastBlockLength = bytesLength % 4;
      if (lastBlockLength) {
        bytesRead = bytesRead.slice(0, lastBlockLength - 4);
      }

      return bytesRead;
    } else {
      // 使用多条多块读取命令循环读取
      // console.time('READ_MULTIPLE_BLOCKS');
      const readMultipleMaxBlocks = readMultipleMaxBytes / 4;
      const chunksToRead = chunk(sameLengthDummyBytes, readMultipleMaxBytes);
      let bytesRead = [];
      for (let i = 0; i < chunksToRead.length; i++) {
        let blocksCount = ~~(chunksToRead[i].length / 4);
        if (chunksToRead[i].length % 4) {
          blocksCount++;
        }
        const block = await NfcManager.nfcVHandler.transceive(
          isAddressed(cmdFlag)
            ? [
                cmdFlag,
                nfcVCmd.READ_MULTIPLE_BLOCKS,
                ...uid,
                startBlock + i * readMultipleMaxBlocks,
                blocksCount,
              ]
            : [
                cmdFlag,
                nfcVCmd.READ_MULTIPLE_BLOCKS,
                startBlock + i * readMultipleMaxBlocks,
                blocksCount,
              ],
        );
        bytesRead.push(...block.slice(1, chunksToRead[i].length + 1));
      }
      // console.timeEnd('READ_MULTIPLE_BLOCKS');
      // 200 bytes: 83.552002 ms
      // 400 bytes: 181.814941 ms
      // 600 bytes: 252.448975 ms

      return bytesRead;
    }
  }
}

async function readNfcVTag({
  tag,
  cmdFlag = NFC_V_CMD_FLAG_ADDRESSED,
  startBlock = 0,
  bytesLength = 4, // how many bytes to read from startBlock ，default is 4 as one block size
  forceReadSingleBlock = false, // if true, 4 by 4 bytes when read many bytes，slowest but more compatible
}) {
  try {
    if (Platform.OS === 'android') {
      // NfcManager.requestTechnology(NfcTech.NfcV, {
      //   alertMessage: '请将 NFC-V 标签靠近设备',
      // });
      // 我的 Android 手机上面的代码会导致第一次触碰会死等在这里，然后第二次触碰 NFC 才能读取数据，因此使用下面的代码
      await NfcManager.connect([NfcTech.NfcV]);
    }

    const uid = hexString2ByteArray(tag.id);

    // 自动使用若干条单块或多块读取命令读取数据
    const bytesRead = await readNfcVTagCanMultiple({
      uid,
      cmdFlag,
      startBlock,
      bytesLength,
      forceReadSingleBlock,
    });

    // console.log('data read:', bytesRead);

    // const data = Buffer.from(bytesRead).toString('hex');
    // console.log('hex data:', data);

    return bytesRead; // 这里 return 了，后面的 finally 仍然会被执行的
  } catch (error) {
    console.error('readNfcVTag failed:', error);
  } finally {
    if (Platform.OS === 'android') {
      // 5. 释放 NFC 资源
      NfcManager.cancelTechnologyRequest().catch(err => console.error(err));
      // 如果想要能再次碰触后读取的，就要用上面，否则用下面的
      // NfcManager.close();
    }
  }
}

async function writeNfcVTag({
  tag,
  cmdFlag = NFC_V_CMD_FLAG_ADDRESSED,
  startBlock = 1, // if forceWriteSingleBlock if false, need startBlock % 4 === 0
  dataToWrite = [], // the bytes to write from startBlock, if dataToWrite.length % 4 !== 0 , will padding 0x00
  forceWriteSingleBlock = true, // if false, 16 bytes each write; if true, 4 bytes each write，slowest but more compatible
  icMfgCode, // if not set, will be uid[6] automatically
}) {
  // console.log('dataToWrite.length: ', dataToWrite.length)
  let verifyRead = [];

  try {
    if (Platform.OS === 'android') {
      await NfcManager.connect([NfcTech.NfcV]);
    }

    const uid = hexString2ByteArray(tag.id);

    if (
      dataToWrite.length <= 4 ||
      forceWriteSingleBlock ||
      startBlock % 4 !== 0
    ) {
      const blocks = chunk(dataToWrite, 4);
      if (blocks.length) {
        const lastBlock = blocks[blocks.length - 1];
        if (lastBlock.length !== 4) {
          lastBlock.push(...new Array(4 - lastBlock.length).fill(0));
        }
      } else {
        return true;
      }

      // console.time('WRITE_SINGLE_BLOCK');
      for (let i = 0; i < blocks.length; i++) {
        const response = await NfcManager.nfcVHandler.transceive(
          isAddressed(cmdFlag)
            ? [
                cmdFlag,
                nfcVCmd.WRITE_SINGLE_BLOCK,
                ...uid,
                startBlock + i,
                ...blocks[i],
              ]
            : [
                cmdFlag,
                nfcVCmd.WRITE_SINGLE_BLOCK,
                startBlock + i,
                ...blocks[i],
              ],
        );
        // console.log('write single block success, response:', response); // success is [0]
      }
      // console.timeEnd('WRITE_SINGLE_BLOCK');
      //  4 bytes: 14.114990 ms
      // 38 bytes: 202.185059 ms

      // if NFC tag hardware not supprt WRITE_MULTIPLE_BLOCKS , use above instead of below
      // const response = await NfcManager.nfcVHandler.transceive(
      //   isAddressed(cmdFlag)
      //     ? [
      //         cmdFlag,
      //         nfcVCmd.WRITE_MULTIPLE_BLOCKS,
      //         ...uid,
      //         startBlock,
      //         blocks.length,
      //         ...dataToWrite,
      //       ]
      //     : [
      //         cmdFlag,
      //         nfcVCmd.WRITE_MULTIPLE_BLOCKS,
      //         startBlock,
      //         blocks.length,
      //         ...dataToWrite,
      //       ];
      // );
    } else {
      const bytes16Blocks = chunk(dataToWrite, 16);
      if (bytes16Blocks.length) {
        const lastBytes16Block = bytes16Blocks[bytes16Blocks.length - 1];
        if (lastBytes16Block.length !== 16) {
          lastBytes16Block.push(
            ...new Array(16 - lastBytes16Block.length).fill(0),
          );
        }
      } else {
        return true;
      }

      const dummy = [19, 49];

      // console.time('WRITE_4_BLOCKS');
      for (let i = 0; i < bytes16Blocks.length; i++) {
        const response = await NfcManager.nfcVHandler.transceive(
          isAddressed(cmdFlag)
            ? [
                cmdFlag,
                nfcVCmd.WRITE_4_BLOCKS,
                icMfgCode || uid[6],
                ...uid,
                startBlock + i * 4,
                ...dummy,
                ...bytes16Blocks[i],
              ]
            : [
                cmdFlag,
                nfcVCmd.WRITE_4_BLOCKS,
                icMfgCode || uid[6],
                startBlock + i * 4,
                ...dummy,
                ...bytes16Blocks[i],
              ],
        );
        // console.log('write 4 blocks success, response:', response); // success is [0]
      }
      // console.timeEnd('WRITE_4_BLOCKS');
      //  4 bytes: 21.427979 ms
      // 38 bytes: 72.591064 ms
    }

    verifyRead = await readNfcVTagCanMultiple({
      uid,
      cmdFlag,
      startBlock,
      bytesLength: dataToWrite.length,
    });
  } catch (error) {
    console.error('writeNfcVTag failed:', error);
  } finally {
    if (Platform.OS === 'android') {
      NfcManager.cancelTechnologyRequest().catch(err => console.error(err));
    }
  }

  // console.log('dataToWrite:', dataToWrite);
  // console.log('verifyRead:', verifyRead);
  if (arraysEqual(dataToWrite, verifyRead)) {
    return true;
  } else {
    return false;
  }
}

// 格式化成功后，第二次格式化会报 unsupported tag api ，且手机也很容易在 APP
// 未启动时调出其它 APP ，直到 writeNfcVTag() 之后才能再格式化一次
// TODO: 格式化后从 android.nfc.tech.NdefFormatable 变成了 android.nfc.tech.Ndef
//       猜测格式化后要切换到 NfcTech.Ndef 而不是继续 NfcTech.NdefFormatable
async function readNdefFormatableTag() {
  try {
    if (Platform.OS === 'android') {
      // await NfcManager.requestTechnology(NfcTech.NdefFormatable, {
      //   alertMessage: '请将 NFC 标签靠近设备',
      // });
      await NfcManager.connect([NfcTech.NdefFormatable]);
    }

    const tag = await NfcManager.getTag();
    tag.ndefStatus = await NfcManager.ndefHandler.getNdefStatus();
    console.log('tag found:', JSON.stringify(tag));

    // if (tag.ndefStatus === NfcManager.NDEF_STATUS_READ_WRITE) {
    // if (tag.ndefMessage) {
    // await readNdefData();
    // // } else if (tag.ndefStatus === NfcManager.NDEF_STATUS_FORMATABLE) {
    // } else {
    await formatAndWriteNdefData();
    // } else {
    //   Alert.alert('Error', 'tag not support NDEF');
    // }
  } catch (error) {
    console.error('readNdefFormatableTag failed:', error);
    Alert.alert('Error', 'readNdefFormatableTag failed: ' + error.message);
  } finally {
    if (Platform.OS === 'android') {
      NfcManager.cancelTechnologyRequest().catch(() => 0);
    }
  }
}

async function readNdefData() {
  try {
    const ndefMessage = await NfcManager.getNdefMessage();
    if (ndefMessage) {
      const records = ndefMessage.map(record => {
        if (record.tnf === Ndef.TNF_WELL_KNOWN && record.type[0] === 0x54) {
          const text = Ndef.text.decodePayload(record.payload);
          return {type: 'text', text};
        } else if (
          record.tnf === Ndef.TNF_WELL_KNOWN &&
          record.type[0] === 0x55
        ) {
          const uri = Ndef.uri.decodePayload(record.payload);
          return {type: 'uri', uri};
        } else {
          return {type: 'unknown', payload: record.payload};
        }
      });
      console.log('NDEF records:', records);
      Alert.alert('Success', 'NDEF data read: ' + JSON.stringify(records));
    } else {
      Alert.alert('Remind', 'No NDEF data in tag');
    }
  } catch (error) {
    console.error('NDEF data read failed:', error);
    Alert.alert('Error', 'NDEF data read failed: ' + error.message);
  }
}

async function formatAndWriteNdefData() {
  try {
    let text = '';
    let bytes = Ndef.encodeMessage([Ndef.textRecord(text)]);

    if (NfcManager.ndefFormatableHandlerAndroid) {
      await NfcManager.ndefFormatableHandlerAndroid.formatNdef(bytes, {});
      console.log('NDEF format successful');

      // 格式化，会让
      // {
      //     "id": "E0A2140100801DE0",
      //     "techTypes": [
      //         "android.nfc.tech.NfcV",
      //         "android.nfc.tech.NdefFormatable"
      //     ]
      // }
      // （const text = '';）变成
      // {
      //     "ndefMessage": [
      //         {
      //             "payload": [
      //                 2,
      //                 101,
      //                 110
      //             ],
      //             "id": "",
      //             "type": [
      //                 84
      //             ],
      //             "tnf": 1
      //         }
      //     ],
      //     "techTypes": [
      //         "android.nfc.tech.NfcV",
      //         "android.nfc.tech.Ndef"
      //     ],
      //     "canMakeReadOnly": false,
      //     "isWritable": true,
      //     "maxSize": 792,
      //     "type": "android.ndef.unknown",
      //     "id": "E0A2140100801DE0"
      // }
      // 或（const text = 'Hello, NFC!';）变成
      // {
      //     "ndefMessage": [
      //         {
      //             "payload": [
      //                 2,
      //                 101,
      //                 110,
      //                 72,
      //                 101,
      //                 108,
      //                 108,
      //                 111,
      //                 44,
      //                 32,
      //                 78,
      //                 70,
      //                 67,
      //                 33
      //             ],
      //             "id": "",
      //             "type": [
      //                 84
      //             ],
      //             "tnf": 1
      //         }
      //     ],
      //     "techTypes": [
      //         "android.nfc.tech.NfcV",
      //         "android.nfc.tech.Ndef"
      //     ],
      //     "canMakeReadOnly": false,
      //     "isWritable": true,
      //     "maxSize": 792,
      //     "type": "android.ndef.unknown",
      //     "id": "E0A2140100801DE0"
      // }
    }

    text = 'Hello, NFC!';
    bytes = Ndef.encodeMessage([Ndef.textRecord(text)]);

    await NfcManager.writeNdefMessage(bytes, {
      reconnectAfterWrite: true,
    });
    console.log('NDEF data write successful:', text);
    Alert.alert('Success', 'Tag is formated and writed data: ' + text);

    await readNdefData();
  } catch (error) {
    console.error('NDEF format or data write failed:', error);
    Alert.alert('Error', 'NDEF format or data write failed: ' + error.message);
  }
}

export {
  NFC_V_CMD_FLAG_IS_ADDRESSED,
  chunk,
  padHexString,
  hexString2ByteArray,
  byteArray2HexString,
  arraysEqual,
  initNfc,
  destroyNfc,
  setSelectNfcVTag,
  readRegNfcVTag,
  readNfcVTagCanMultiple,
  readNfcVTag,
  writeNfcVTag,
};
