const express = require("express");
const bodyParser = require("body-parser");
const axios = require("axios");
const Mixpanel = require("mixpanel");
const fs = require("fs/promises");
const path = require("path");
const { exec, spawn } = require("child_process");
const { MongoClient } = require("mongodb");
const cors = require("cors");
const execOptions = { windowsHide: true };
const app = express();
const { Storage } = require("@google-cloud/storage");
const storage = new Storage({
  keyFile: "./public/key.json",
});
const port = 3001;
let check = false;
let flag = false;
let jsonData;
const publicDir = path.join(__dirname, "public");
const dataDir = path.join(process.cwd(), "data");
app.use(express.static(publicDir));
app.use(bodyParser.json());
app.use(cors());
let mixpanel;
const folderPath = process.cwd();

let arr = [];
const bucketName = "adloid-products";
const folderName = "hero-sd-web/links/dealership-dev/814";
async function syncBuild() {
  try {
    const [files] = await storage.bucket(bucketName).getFiles({
      prefix: folderName,
    });

    files.map((file) => {
      const fileName = file.name.split("/")[4];
      if (fileName.startsWith("main")) {
        arr.push(file);
      }
    });

    arr.sort(
      (a, b) =>
        new Date(b.metadata.timeCreated) - new Date(a.metadata.timeCreated)
    );
    const latestBuild = arr[0].metadata;
    const latestBuildHash = latestBuild.name.split(".")[1];
    arr = [];
    files.map((file) => {
      const fileName = file.metadata.name.split("/")[4];
      if (fileName.includes(latestBuildHash)) {
        arr.push(file);
      }
    });

    const relativePath = "../../../../Hero/Game/hero-sd-web";
    const targetDir = path.resolve(folderPath, relativePath);
    console.log(targetDir, "target directory", folderPath);

    const directoryFiles = await fs.readdir(relativePath);

    let flag = false;
    arr.forEach(async (file) => {
      const fileName = file.metadata.name.split("/")[4];
      if (!directoryFiles.includes(fileName)) {
        flag = true;
        await downloadFile(file.metadata.name);
      }
    });
    if (flag == true) {
      await deleteFiles();
    }
  } catch (error) {
    console.error("Error fetching files:", error);
  }
}

async function downloadFile(fileName) {
  const relativePath = "../../Game/hero-sd-web";
  const targetDir = path.resolve(folderPath, relativePath);
  console.log(targetDir, "target directory");

  const destination = targetDir + "/" + fileName.split("/")[4];
  const options = {
    destination: destination,
  };
  const data = await storage
    .bucket(bucketName)
    .file(fileName)
    .download(options);
  let destFile;
  if (fileName.includes("main")) {
    destFile = targetDir + "/" + "js1.js";
  } else {
    destFile = targetDir + "/" + "js2.js";
  }
  await copyContent(destination, destFile);
  return;
}

async function deleteFiles() {
  const relativePath = "../../Game/hero-sd-web";
  const targetDir = path.resolve(folderPath, relativePath);
  try {
    const directoryFiles = await fs.readdir(targetDir);
    if (directoryFiles.length == 0) {
      console.log("no files present to be deleted");
    }
    directoryFiles.forEach(async (file) => {
      if (file.startsWith("main") && file.length > 10) {
        const hashedString = file.split(".")[1];
        const filePath = path.join(targetDir, file);
        const build2 = directoryFiles.find((f) => f.includes(hashedString));
        await fs.unlink(filePath);
        const build2Path = path.join(targetDir, build2);
        await fs.unlink(build2Path);

        console.log(`File ${file} deleted successfully.`);
      }
    });
  } catch (error) {
    console.error("Error deleting files:", error);
  }
}

async function copyContent(source, destination) {
  try {
    await fs.access(source);

    const destExists = await fileExists(destination);

    if (!destExists) {
      const dir = path.dirname(destination);
      await fs.mkdir(dir, { recursive: true });
      console.log(`Created directory: ${dir}`);
    }

    const content = await fs.readFile(source, "utf8");

    await fs.writeFile(destination, content);

    console.log(
      `Content copied from ${source} to ${destination} successfully.`
    );
  } catch (error) {
    throw new Error(`Error copying content: ${error.message}`);
  }
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch (error) {
    return false;
  }
}

const MONGO_URI =
  "mongodb://127.0.0.1:27017/?directConnection=true&serverSelectionTimeoutMS=2000";
const DATABASE_NAME = "hero";
const COLLECTION_NAME = "heartbeat";
const client = new MongoClient(MONGO_URI);

const REMOTE_MONGO_URI =
  "mongodb+srv://userMG99:wkCbQHHaAd2tpA1F@cluster0.ssu9j.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0";
const remoteClient = new MongoClient(REMOTE_MONGO_URI);
const CLOUD_DB_NAME = "HeroPricingV2";
const CLOUD_COLLECTION = "data";

const connectToMongoDB = async () => {
  try {
    await client.connect();
    console.log("connected to mongodb");
  } catch (error) {
    console.log("unable to connect to mongodb", error.message);
    throw error;
  }
};

const connectToCloudMongoDB = async () => {
  try {
    await remoteClient.connect();
    console.log("connected to cloud mongodb");
  } catch (error) {
    console.log("unable to connect to mongodb", error.message);
    throw error;
  }
};

connectToMongoDB();
connectToCloudMongoDB();

const fetchPricing = async () => {
  try {
    const collections = await client
      .db(DATABASE_NAME)
      .listCollections({ name: "pricing" })
      .toArray();

    if (collections.length > 0) {
      await client.db(DATABASE_NAME).dropCollection("pricing");
      console.log("Collection dropped successfully.");
    } else {
      console.log("Collection does not exist.");
    }

    const remoteData = await remoteClient
      .db(CLOUD_DB_NAME)
      .collection(CLOUD_COLLECTION)
      .find({})
      .toArray();
    // console.log(remoteData)
    if (remoteData.length > 0) {
      const result = await client
        .db(DATABASE_NAME)
        .collection("pricing")
        .insertMany(remoteData);
      console.log(
        `${result.insertedCount} documents inserted into the local 'pricing' collection.`
      );
    } else {
      console.log("No data fetched from remote MongoDB Atlas collection.");
    }
  } catch (error) {
    console.error("Error:", error);
  }
};

fetchPricing();

const saveDataToMongoDB = async (data) => {
  try {
    const database = client.db(DATABASE_NAME);
    const collection = database.collection(COLLECTION_NAME);

    const result = await collection.insertOne(data);
    console.log("Document inserted successfully:", result);
    return result;
  } catch (err) {
    console.error("Error saving data to MongoDB:", err);
    throw err;
  }
};

const writeSyncVars = async () => {
  try {
    const filePath = path.join(process.cwd(), "sync-vars.txt");
    await fs.writeFile(filePath, Date.now().toString());
    console.log("updated sync vars");
    return true;
  } catch (error) {
    console.error("Error writing sync vars:", error);
    throw error;
  }
};

const initMixpanel = (projectName, product, location) => {
  mixpanel = Mixpanel.init(
    "3291b2df6a504291a1f5b90bee1b836a",
    { debug: true, test: true, verbose: true, geolocate: true },
    projectName,
    {
      defaultProps: {
        // Define your static fields here
        product: product,
        modelId: 123,
        fromLink: "123",
        vehicleType: "bike",
        location: location ?? "India",
      },
    }
  );
  // const distinctId = mixpanel.get_distinct_id();
  // mixpanel.people.set({ id: distinctId });
  // mixpanel.identify(distinctId);

  // mixpanel.register({
  //   product,
  //   modelId: 123,
  //   fromLink: "123",
  //   vehicleType: 'bike',
  //   location: location ?? 'India'
  // })
  // console.log('Mixpanel initialized successfully', mixpanel);
};

initMixpanel("hero-sd-web", "hero", "India");

const isInternet = async () => {
  var data = false;
  await axios
    .get("https://www.google.com")
    .then((response) => (data = true))
    .catch((err) => (data = false));

  return data;
};

const sendToMixpanel = async (data) => {
  const requestOptions = {
    headers: {
      "Content-Type": "application/json",
      Authorization:
        "Basic bWV0YWRvbWUtaGVyb2RlYWxlcnNoaXAtd2ViLmM3OTdjNC5tcC1zZXJ2aWNlLWFjY291bnQ6OTg1TDllMXhrbjlNMG50QThUSTVJeEZDaXZqVUl2b1M=",
    },
  };

  try {
    const response = await axios.post(
      "https://api.mixpanel.com/import?strict=1&project_id=2846568",
      data,
      requestOptions
    );
    console.log(response.data);
    return response.data;
  } catch (error) {
    console.log(error.message);
  }
};

const sendLogToInfraCost = async (data) => {
  let count = 0;
  const infraId = "test_id";
  const parsedProperties = JSON.stringify(data.properties);
  const infraData = [
    {
      key: infraId,
      value: {
        uid: data.uid,
        sid: data.sid,
        event_name: data.event,
        event_value: parsedProperties,
        created_at: Math.floor(Date.now() / 1000).toString(),
      },
    },
  ];

  const parsedData = JSON.stringify(infraData);
  console.log(parsedData);

  try {
    const response = await axios.post(
      "https://api.metadome.ai/infracost/",
      parsedData,
      {
        headers: {
          "Content-Type": "application/json",
        },
      }
    );
    console.log("Log sent to Infracost API successfully", response.data);
    count++;
  } catch (error) {
    console.error("Error sending log to Infracost API:", error.message);
    throw error;
  }
};

const sendBatchData = async (eventData) => {
  let i = 0;
  const batchSize = Math.min(1000, eventData.length);
  while (i < eventData.length) {
    const batchData = eventData.slice(i, i + batchSize);
    await sendToMixpanel(batchData);
    i += batchSize;
  }
};

const syncData = async () => {
  const internet = await isInternet();
  if (internet == true) {
    const filePath = path.join(process.cwd(), "sync-vars.txt");
    const fileExists = await fs
      .access(filePath)
      .then(() => true)
      .catch(() => false);
    if (!fileExists) {
      await writeSyncVars();
    }
    const date = fs.readFile("sync-vars.txt");

    const parsedData = parseInt((await date).toString());

    console.log(parsedData, "updated sync time");

    const eventData = await client
      .db(DATABASE_NAME)
      .collection(COLLECTION_NAME)
      .find({ created_at: { $gt: parsedData } })
      .project({ _id: 0, sid: 0, uid: 0, created_at: 0 })
      .toArray();

    const infraData = await client
      .db(DATABASE_NAME)
      .collection(COLLECTION_NAME)
      .find({ created_at: { $gt: parsedData } })
      .project({ _id: 0 })
      .toArray();

    console.log(infraData, "infra data");
    if (eventData.length) {
      sendBatchData(eventData);
      writeSyncVars();
    }

    for (let i = 0; i < infraData.length; i++) {
      sendLogToInfraCost(infraData[i]);
    }
  } else {
    return { internet: false, success: false };
  }
};

const createDataDirectory = async () => {
  try {
    await fs.mkdir(dataDir, { recursive: true });
    console.log("Created 'data' folder.");
  } catch (error) {
    if (error.code === "ENOENT") {
      await fs.mkdir(dataDir, { recursive: true });
    } else if (error.code === "EEXIST") {
      console.log("'data' folder already exists.");
    } else {
      console.error("Error creating 'data' folder:", error);
    }
  }
};

const checkDataDirectory = async () => {
  try {
    await fs.access(dataDir);
    console.log("'data' folder exists.");
  } catch (error) {
    if (error.code === "ENOENT") {
      console.log("'data' folder does not exist.");
      await createDataDirectory();
    } else {
      console.error("Error checking 'data' folder:", error);
    }
  }
};

const fetchData = async () => {
  // Ensure the 'data' directory exists
  await checkDataDirectory();

  try {
    const jsonFiles = (await fs.readdir(dataDir)).filter((file) =>
      file.endsWith(".json")
    );
    console.log(jsonFiles, "these");
    if (jsonFiles == [] || jsonFiles.length > 0) {
      const firstJsonFile = jsonFiles[0];
      const res = JSON.parse(
        await fs.readFile(path.join(dataDir, firstJsonFile), "utf-8")
      );
      return res;
    }
  } catch (error) {
    console.error("Error reading JSON data:", error, dataDir, "hello");
  }
  return null;
};

const checkGPU = async () => {
  if (process.platform == "win32") {
    return new Promise((resolve, reject) => {
      exec(
        `start /B nvidia-smi --query-gpu=utilization.gpu --format=csv,noheader,nounits`,
        execOptions,
        (error, stdout) => {
          const gpuUsage = parseFloat(stdout.trim());
          resolve(gpuUsage);
        }
      );
    });
  } else {
    console.log("Unsupported operating system.");
    reject("Unsupported operating system.");
  }
};

const checkAppRunning = async (appName) => {
  if (!appName) return false;
  return new Promise((resolve, reject) => {
    if (process.platform == "darwin" || process.platform == "linux") {
      exec(`ps aux | grep -v grep | grep '${appName}'`, (error, stdout) => {
        if (!error && stdout) {
          resolve({ success: true, isRunning: true });
        } else {
          console.log(`app ${appName} isn't running`);
          reject(new Error(`app ${appName} isn't running`));
          console.log("failed");
        }
      });
    } else if (process.platform === "win32") {
      console.log("Checking on Windows...");
      exec(`tasklist /FI "IMAGENAME eq ${appName}.exe"`, (error, stdout) => {
        if (!error && stdout.toLowerCase().includes(appName.toLowerCase())) {
          resolve({ success: true, isRunning: true });
          console.log("App is running on Windows.");
        } else {
          resolve({ success: false, isRunning: false });
          console.error("App is not running on Windows.");
        }
      });
    } else {
      console.log("Unsupported operating system.");
      reject("Unsupported operating system.");
    }
  });
};

const initializeJsonData = async () => {
  jsonData = await fetchData();
  if (jsonData) {
    return jsonData;
  } else {
    console.log("no data here");
  }
};

const sendPing = async (jsonData) => {
  try {
    const apiResponse = await axios.post(
      "https://api.metadome.ai/heartbeat-dev/ping",
      jsonData
    );
    return apiResponse.data;
  } catch (error) {
    console.error("API error:", error.message);
    throw new Error("Error submitting data to the API.");
  }
};

app.get("/data", async (req, res) => {
  const resp = await fetchData();
  if (resp) {
    return res.json({ result: resp });
  } else {
    res.status(404).json({ error: "Data not found" });
  }
});

app.put("/update", async (req, res) => {
  const data = req.body;
  try {
    if (
      !data ||
      !data.client ||
      !data.store ||
      !data.software ||
      !data.appsArray
    ) {
      return res.status(400).json({ error: "Invalid data in the request" });
    }
    const dataDir = path.join(process.cwd(), "data");

    const jsonFiles = await fs.readdir(dataDir);

    const filteredJsonFiles = jsonFiles.find((file) => file.endsWith(".json"));
    if (filteredJsonFiles.length > 0) {
      jsonData = {
        client: data.client,
        store: data.store,
        software: data.software,
        appsArray: data.appsArray,
      };
      const dataToWrite = JSON.stringify(jsonData, null, 2);
      const clientFile = path.join(dataDir, filteredJsonFiles);
      const checkFile = await fs.access(clientFile);

      fs.writeFile(clientFile, dataToWrite, {
        encoding: "utf8",
        flag: "w",
      });
      return res.status(200).json({ message: "Data updated successfully" });
    } else {
      console.log("No JSON files found in the directory.");
    }
  } catch (error) {
    console.log("error editing file :", error);
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

app.post("/submit", async (req, res) => {
  const formData = req.body;
  console.log(formData);

  if (!formData.client || !formData.store || !formData.software) {
    console.error("Missing client, store, or software in formData.");
    return res.status(400).send("Missing client, store, or software.");
  }

  const filePath = path.join(dataDir, `${formData.client}.json`);

  const result = JSON.stringify(formData, null, 2);
  try {
    await fs.writeFile(filePath, result);
    initializeJsonData();
    const appsArray = formData.appsArray || [];
    console.log(appsArray);
    flag = true;
    return res.redirect("/success");
  } catch (error) {
    console.error("Error writing JSON file:", error);
    return res.status(500).send("Error writing JSON file.");
  }
});

app.get("/", (req, res) => {
  res.sendFile(path.join(publicDir, "index.html"));
});

app.get("/home", (req, res) => {
  res.sendFile(path.join(publicDir, "data.html"));
});

app.get("/edit", (req, res) => {
  res.sendFile(path.join(publicDir, "edit.html"));
});

app.get("/success", (req, res) => {
  flag = true;
  res.sendFile(path.join(publicDir, "success.html"));
});

app.post("/flag", (req, res) => {
  let { flag } = req.body;

  if (flag !== undefined) {
    const newFlag = Boolean(flag);
    flag = newFlag;
    check = flag;
    res.json({ flag: newFlag });
  } else {
    res.status(400).json({ error: "Invalid flag value" });
  }
});

app.get("/frontend-ping", async (req, res) => {
  const gpuResult = await checkGPU();
  if (!jsonData) {
    console.log("data not found");
  } else {
    console.log("Checking app status of :", jsonData);
    const appsArray = jsonData.appsArray || [];
    for (let i = 0; i < appsArray.length; i++) {
      let eachApp = appsArray[i];
      try {
        let appData;
        const checkApp = await checkAppRunning(eachApp);
        if (checkApp && gpuResult > 20) {
          console.log(`app ${eachApp} is running and gpu is ${gpuResult}`);
          appData = {
            app: eachApp,
            status: checkApp.isRunning,
            gpu: gpuResult,
          };
        } else {
          console.log(
            `App is not running because app status is ${checkApp.isRunning} and gpu is ${gpuResult}`
          );
          appData = {
            app: eachApp,
            status: checkApp.isRunning,
            gpu: gpuResult,
          };
        }
        res.status(200).json({
          data: appData,
        });
      } catch (error) {
        console.error("Error checking app status:", error.message);
        res.status(500).json({
          data: error.message,
          message: "internal server error",
        });
      }
    }
  }
});

app.post("/event", async (req, res) => {
  try {
    const body = req.body;
    if (!body || Object.keys(body).length === 0) {
      throw new Error(
        "Bad Request: event json must be provided in the request body"
      );
    }
    if (!body.event || !body.properties || !body.uid || !body.sid) {
      throw new Error("Bad Request: provide properties, event, sid and uid");
    }

    const dataSaved = await saveDataToMongoDB(body);
    res.status(200).json({ message: "data saved", data: dataSaved });
  } catch (error) {
    console.error("Error:", error.message);
    res.status(500).json({ message: "Event post failed", data: error.message });
  }
});

app.get("/pricing", async (req, res) => {
  const { STATE, CITY, Model, VARIANT } = req.query;
  if (!STATE || !CITY || !Model || !VARIANT) {
    return res.status(400).json({
      message: "Provide state, city, model, and variant in query params",
    });
  }

  try {
    const fetchedPrice = await client
      .db(DATABASE_NAME)
      .collection("pricing")
      .findOne({
        STATE: STATE.toUpperCase(),
        CITY: CITY.toUpperCase(),
        Model: Model.toUpperCase(),
        VARIANT: VARIANT.toUpperCase(),
      });
    // const fetchedPrice = await client.db(DATABASE_NAME).collection('pricing').find({}).toArray();

    console.log(req.query, fetchedPrice);
    if (fetchedPrice) {
      return res.status(200).json({
        data: fetchedPrice,
      });
    } else {
      return res.status(404).json({
        message:
          "Price not found for the provided state, city, model, and variant",
      });
    }
  } catch (error) {
    console.error("Error fetching price:", error);
    return res.status(500).json({
      message: "Internal server error",
    });
  }
});

app.listen(port, async () => {
  console.log(`Server is running on port ${port}`);
  jsonData = await fetchData();
  console.log(jsonData, "this is json data");
  flag = false;
  // if (jsonData) {
  //   openBrowser(`http://localhost:${port}/home`);
  // }
  if (!jsonData) {
    openBrowser(`http://localhost:${port}`);
  }
});

const openBrowser = (url) => {
  switch (process.platform) {
    case "darwin":
      spawn("open", [url]);
      break;
    case "win32":
      spawn("start", [url], { shell: true });
      break;
    default:
      spawn("xdg-open", [url]);
  }
};

const main = async () => {
  console.log("version 5.0");
  syncData();
  console.log(check);
  if (check === false) {
    console.log("Not started interval yet");
  } else {
    if (!jsonData) {
      console.log("data not found");
    } else {
      const appsArray = jsonData.appsArray || [];
      for (let i = 0; i < appsArray.length; i++) {
        let eachApp = appsArray[i];

        try {
          const checkApp = await checkAppRunning(eachApp);
          console.log(checkApp, "stat");
          if (checkApp) {
            const appData = {
              client: jsonData.client,
              store: jsonData.store,
              software: jsonData.software,
              app: eachApp,
              status: checkApp.success,
            };

            await sendPing(appData);
          } else {
            console.log("App is not running");
          }
        } catch (error) {
          console.error("Error checking app status:", error.message);
        }
      }
    }
  }
};

setInterval(() => {
  main();
}, 5 * 1000);

setInterval(async () => {
  //fetchPricing();
  const internet = await isInternet();
  if (internet) {
    syncBuild();
  }
}, 5 * 1000);
