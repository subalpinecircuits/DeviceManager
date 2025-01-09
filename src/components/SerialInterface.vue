<template>
  <div class='serial-interface'>
    <h3 v-if='page === "default"'>Select a mode</h3>
    <h3 v-if='page === "manage" || page === "patch"'>Current device: {{ currentDeviceStr }}</h3>
    <h3 v-if='page === "program"'>Chip info: {{ currentChipInfo }}</h3>

    <div class='buttons' v-if='page === "default"'>
      <button @click='page = "manage"'>manage device</button>
      <button @click='page = "program"'>upload firmware</button>
    </div>

    <div class='buttons' v-if='page === "manage"'>
      <button @click='onDisconnect()'>&lt;</button>
      <button @click='onConnect()' v-if='!port'>connect</button>
      <button @click='onDisconnect' v-if='port'>disconnect</button>
      <button :disabled="!port" @click='writeCommand("call:m")'>free memory</button>
      <button :disabled="!port" @click='onRestart'>restart</button>
      <button :disabled="!port" @click='writeCommand("call:d")'>dump patch</button>
      <button @click='page = "patch"'>inspect/load patch</button>
    </div>

    <div class='buttons' v-if='page === "program"'>
      <button @click='page = "default"'>&lt;</button>
      <input id='upload-file' style='display: none;' type='file' ref='file' @change='onFileSelect'>
      <label class='fake-button' for='upload-file'>
        {{ uploadFilename }}
      </label>
      <button @click='onFlash'>flash</button>
    </div>

    <div class='buttons' v-if='page === "patch"'>
      <button @click='page = "manage"'>&lt;</button>
      <input v-model='patchInput' class="patch-input" type="text" placeholder="enter base64 patch">
      <button :disabled="!patchValid || !port" @click='onUploadPatch'>upload</button>
    </div>

    <ol ref='$lines'>
      <li v-for="line in lines">
        {{ line }}
      </li>
    </ol>

  </div>
</template>

<script setup lang="ts">
import { ref, watchEffect } from 'vue';
import { PresetSchema } from '../gen/Preset_pb.ts'
import { fromBinary, type DescField } from '@bufbuild/protobuf'
import { base64Decode } from "@bufbuild/protobuf/wire";
import { ESPLoader, Transport, type LoaderOptions, type FlashOptions } from 'esptool-js'
import * as CryptoJS from 'crypto-js'

// see https://wicg.github.io/serial/
class LineBreakTransformer {
  container: string;

  constructor() {
    this.container = '';
  }

  transform(chunk: string, controller: TransformStreamDefaultController) {
    this.container += chunk;
    const lines = this.container.split('\r\n');
    this.container = lines.pop() || '';
    lines.forEach(line => controller.enqueue(line));
  }

  flush(controller: TransformStreamDefaultController) {
    controller.enqueue(this.container);
  }
}

const page = ref('default')

const lines = ref<Array<string>>([])
const $lines = ref()
const currentDeviceStr = ref("none")
const currentChipInfo = ref("none")
const port = ref<SerialPort>()
const closing = ref(false)

const fileData = ref()

const uploadFilename = ref('select a file')

const patchInput = ref('')
const patchValid = ref(false)

watchEffect(() => {
  patchValid.value = false
  if (page.value === "patch" && patchInput.value.length > 0) {
    lines.value = ["patch: " + patchInput.value];
    addLine("", false)
    try {
      const b64Decoded = base64Decode(patchInput.value);
      let decoded = fromBinary(PresetSchema, b64Decoded);
      patchValid.value = true
      PresetSchema.fields.forEach((f: DescField) => {
        addLine(f.localName + ": " + (decoded as Record<string, any>)[f.localName], false)
      })
    }
    catch (e) {
      console.log("parse error: " + (e as Error).message)
      resetLines()
      addLine("parse error", false)
    }
  }
  else if (page.value === "patch") {
    resetLines()
  }
})

const resetLines = () => { lines.value = [] }

const addLine = (line: string, scrollToBottom: boolean) => {
  lines.value.push(line)

  if (scrollToBottom && $lines.value) {
    setTimeout(() => {
      $lines.value.scrollTo(0, $lines.value.scrollHeight);
    }, 0)
  }
}

const onConnect = async () => {
  port.value = await navigator.serial.requestPort();
  await port.value.open({ baudRate: 115200 });

  let lineReader = port.value.readable?.pipeThrough(new TextDecoderStream()).pipeThrough(new TransformStream(new LineBreakTransformer())).getReader();

  writeCommand("call:i");

  while (true) {
    if (lineReader) {
      const { value } = await lineReader.read();
      console.log(value)
      if (value && value.indexOf("resp:") !== -1) {
        const m = value.match(/resp:([a-z]):(.*)/)

        if (m[1]) {
          switch (m[1]) {
            case "i":
              currentDeviceStr.value = m[2]
              break;
            case "d":
              lines.value = ["current patch: " + m[2]];
              addLine("", false)
              const b64Decoded = base64Decode(m[2]);
              let decoded = fromBinary(PresetSchema, b64Decoded);
              PresetSchema.fields.forEach((f: DescField) => {
                addLine(f.localName + ": " + (decoded as Record<string, any>)[f.localName], false)
              })

              break;
            case "m":
              resetLines()
              addLine("free memory: " + m[2] + " bytes", false)
              break;
          }
        }
      }

      if (closing.value) {
        await lineReader.cancel()
        await port.value.close()
      }
    }
  }
}

const onDisconnect = async () => {
  window.location.reload();
  // TODO
  // streams are hard
  // 
  // closing.value = true
  // await port.value?.close()
  // port.value = undefined
  // currentDeviceStr.value = "none"
}

const onRestart = () => {
  writeCommand("restart");
  window.location.reload();
}

const onUploadPatch = async () => {
  await writeCommand(`import ${patchInput.value}`)
}

let espLoaderTerminal = {
  clean() {
    resetLines()
  },
  writeLine(data: string) {
    addLine(data, true)
  },
  write(data: string) {
    addLine(data, true)
  },
};

const onFileSelect = (e: Event) => {
  if (!e.target) { return }

  const input = (e.target as HTMLInputElement)

  if (!input) { return }

  const file = (input.files || [])[0]

  if (!file) { return }

  uploadFilename.value = 'file: ' + file.name

  fileData.value = undefined;

  const reader = new FileReader();

  reader.onload = (ev: ProgressEvent<FileReader>) => {
    fileData.value = ev.target?.result;
  };

  reader.readAsBinaryString(file);
}

const onFlash = async () => {
  // if (!port.value) { return }

  const device = await navigator.serial.requestPort({});
  const transport = new Transport(device, true);

  const loaderOptions = {
    transport,
    baudrate: 921600,
    terminal: espLoaderTerminal,
    debugLogging: false,
  } as LoaderOptions;

  const esploader = new ESPLoader(loaderOptions);

  currentChipInfo.value = await esploader.main();

  const flashOptions: FlashOptions = {
    fileArray: [{ data: fileData.value as string, address: 0x10000 }],
    flashSize: "keep",
    eraseAll: false,
    compress: true,
    flashMode: 'DIO',
    flashFreq: '80MHZ',
    reportProgress: () => { },
    calculateMD5Hash: (image: string) => CryptoJS.MD5(CryptoJS.enc.Latin1.parse(image)).toString(),
  } as FlashOptions;

  await esploader.writeFlash(flashOptions);

  await transport.setDTR(false);
  await new Promise((resolve) => setTimeout(resolve, 100));
  await transport.setDTR(true);
  transport.disconnect();
  resetLines();
  currentChipInfo.value = ""
  page.value = "default"
}

const writeCommand = async (command: string) => {
  const encoder = new TextEncoder();
  if (!port.value) { console.info("port is undefined"); return }
  if (!port.value.writable) { console.info("port is not writeable"); return }
  const writer = port.value.writable.getWriter();
  await writer.write(encoder.encode(command + "\n"));
  writer.releaseLock();
}
</script>

<style scoped lang='scss'>
.serial-interface {
  .buttons {
    display: flex;
    gap: 10px;
  }

  ol {
    height: 60vh;
    overflow: scroll;
    overflow-wrap: break-word;

    padding: 8px;
    border: 1px solid black;
    margin: 20px 0 0 0;

    list-style: none;

    li {
      min-height: 20px;
    }
  }

  .patch-input {
    padding: 0 10px;
  }
}
</style>
