//constant variables

const API_URL = "http://localhost:5000";
var _loader = 0;

// elements
const run_button = document.querySelector("#run");
const abort_button = document.querySelector("#abort");
const pipeline_target = document.querySelector("#pipeline-target");

//build interface
const build_interface = {
  id: 0,
  target: "",
  steps: [""],
  activeStep: "",
  version: "",
  percentage: 0,
  started: new Date(),
  ended: new Date(),
  error: "",
  isAborted: false,
};

var new_build = false;
var builds = [build_interface];
var active_pipelines = [build_interface];
active_pipelines = [];

const onPipelineStateChange = () => {
  if (active_pipelines.length > 0) {
    run_button.style.display = "none";
    abort_button.style.display = "flex";
  } else {
    run_button.style.display = "flex";
    abort_button.style.display = "none";
  }
};

const update_pipeline = (pipeline = build_interface) => {
  let target = active_pipelines.find(p => p.id === pipeline.id);
  target = pipeline;
  onPipelineStateChange();
};

const add_pipeline = (pipeline = build_interface) => {
  let exists = active_pipelines.find(b => b.id === pipeline.id);
  if (!exists) active_pipelines.push(pipeline);
  onPipelineStateChange();
};

const remove_pipeline = (pipeline = build_interface) => {
  let target = active_pipelines.find(p => p.id === pipeline.id);
  let index = active_pipelines.indexOf(target);
  if (index > -1) {
    active_pipelines.splice(index, 1);
  }

  onPipelineStateChange();
};

//#region ui methods

/**
 *
 */
function ShowLoader() {
  _loader++;
  document.querySelector("#loader").style.display = "flex";
}

/**
 *
 */
function HideLaoder() {
  if (_loader - 1 >= 0) _loader -= 1;
  if (_loader === 0) document.querySelector("#loader").style.display = "none";
}

function ClearLogsPanel() {
  let logPanel = document.querySelector("#logs-panel");
  logPanel.value = "";
}

// prettier-ignore
function render_build_component(build = build_interface) {
  let info_ended = build.ended
    ? `<p>ended: ${
        new Date(build.ended).toLocaleDateString() +
        ":" +
        new Date(build.ended).toLocaleTimeString()
      }</p>`
    : "";
  pipeline_target.innerHTML += `
  <!-- Container -->
    <div class="pipeline-container" id="build-container-${build.id}">
      <!-- Content Wrapper -->
      <div class="pipeline-content-wrapper">
        <!-- steps table -->
        <table class="steps-component">
            <thead>
              <tr>
                ${build.steps
                  .map(step => render_step_component(step))
                  .join("")}
              </tr>
            </thead>
            <tbody>
              <!-- One Row Per Pipeline -->
              <tr>
                <td colspan="${build.steps.length}">
                  <!-- progress section -->
                    <section>
                      <!-- percentage based progress meter -->
                        <progress id="build-${build.id}" value="${build.percentage}" max="100"></progress>
                      </section>
                  </td>
              </tr>
            </tbody>
        </table>
        <div class="info">
          <p>id: ${build.id}</p>
          <p>version: ${build.version}</p>
          <p>started: ${new Date(build.started).toLocaleDateString() +":" +new Date(build.started).toLocaleTimeString()}</p>
          ${info_ended}
        </div>
      </div>
    </div>`;
}

function render_step_component(step) {
  return `<th>${step}</th>`;
}

//#endregion

//#region general helper utils

function tryParse(s) {
  try {
    return JSON.parse(s);
  } catch (error) {
    console.log("tryparse error: ", error);
    return null;
  }
}

function cron(ms, callback) {
  const maxTimeout = 2147483647; // Maximum timeout allowed in JavaScript
  (() => {
    return new Promise(async (resolve, reject) => {
      if (ms > maxTimeout) {
        let chunks = ms / maxTimeout;
        let full_iterations = Math.ceil(chunks);
        let remaining_time = full_iterations === 1 ? ms : ms % maxTimeout;
        for (let i = 0; i < full_iterations; i++) {
          await wait(maxTimeout);
        }
        await wait(remaining_time);
        if (callback) callback();
      } else {
        setTimeout(
          () => {
            if (callback) callback();
            resolve(null);
          },
          ms ? ms : 1
        );
      }
    });
  })().then(() => {
    cron(ms, callback);
  });
}

function wait(ms, callback) {
  setTimeout(callback, ms);
}

//#endregion

//#region  http methods

/**
 * Uses the default http config to make a GET request to the backend services
 * auto handles user auth config, and response parsing
 * @param {*} path the api url
 * @param {*} headers an array of headers to set for the request [{key, value}]
 * @returns
 */
function GET(path, headers = []) {
  return new Promise(resolve => {
    let request = new XMLHttpRequest();
    request.open("GET", API_URL + path);
    //set headers
    headers.forEach(header => {
      request.setRequestHeader(header.key, header.value);
    });
    request.send();
    request.onload = () => {
      let response = { status: request.status, ...tryParse(request.response) };
      return resolve(response);
    };
    request.onerror = () => {
      return resolve(request);
    };
  });
}

/**
 * Uses the default http config to make a POST request to the backend services
 * auto handles user auth config, and response parsing
 * @param {*} path the api url
 * @param {*} body JSON request body to send in the post
 * @param {*} headers an array of headers to set for the request
 * @returns
 */
function POST(
  path,
  body,
  headers = [{ key: "Content-Type", value: "application/json" }]
) {
  return new Promise(resolve => {
    let request = new XMLHttpRequest();
    request.open("POST", API_URL + path);
    //set headers
    headers.forEach(header => {
      request.setRequestHeader(header.key, header.value);
    });
    request.send(JSON.stringify(body));
    request.onload = () => {
      let response = { status: request.status, ...tryParse(request.response) };
      return resolve(response);
    };
    request.onerror = e => {
      console.log("POST ERROR: ", e);
      return resolve(request);
    };
  });
}

/**
 * Uses the default http config to make a POST request to the backend services
 * auto handles user auth config, and response parsing
 * @param {*} path the api url
 * @param {*} body JSON request body to send in the put
 * @param {*} headers an array of headers to set for the request
 * @returns
 */
function PUT(path, body, headers = []) {
  return new Promise(resolve => {
    let request = new XMLHttpRequest();
    request.open("PUT", API_URL + path);
    //set headers
    headers.forEach(header => {
      request.setRequestHeader(header.key, header.value);
    });
    request.send(JSON.stringify(body));
    request.onload = () => {
      let response = { status: request.status, ...tryParse(request.response) };

      return resolve(response);
    };
    request.onerror = () => {
      return resolve(request);
    };
  });
}

/**
 * Uses the default http config to make a POST request to the backend services
 * auto handles user auth config, and response parsing
 * @param {*} path the api url
 * @param {*} body JSON request body to send in the patch
 * @param {*} headers an array of headers to set for the request
 * @returns
 */
function PATCH(path, body, headers = []) {
  return new Promise(resolve => {
    let request = new XMLHttpRequest();
    request.open("PATCH", API_URL + path);
    //set headers
    headers.forEach(header => {
      request.setRequestHeader(header.key, header.value);
    });
    request.send(JSON.stringify(body));
    request.onload = () => {
      let response = { status: request.status, ...tryParse(request.response) };

      return resolve(response);
    };
    request.onerror = () => {
      return resolve(request);
    };
  });
}

/**
 * Uses the default http config to make a POST request to the backend services
 * auto handles user auth config, and response parsing
 * @param {*} path the api url
 * @param {*} body JSON request body to send in the delete
 * @param {*} user the logged in user object
 * @param {*} headers an array of headers to set for the request
 * @returns
 */
function DELETE(path, body, headers = []) {
  return new Promise(resolve => {
    let request = new XMLHttpRequest();
    request.open("DELETE", API_URL + path);
    //set headers
    headers.forEach(header => {
      request.setRequestHeader(header.key, header.value);
    });
    request.send(JSON.stringify(body));
    request.onload = () => {
      let response = { status: request.status, ...tryParse(request.response) };

      return resolve(response);
    };
    request.onerror = () => {
      return resolve(request);
    };
  });
}

//#endregion

//#region Functional Logic

async function GetTargetList() {
  let response = await GET("/targets");

  let options = response.targets;

  let select = document.querySelector("#enviornment-select");

  const priority = ["dev", "staging", "prod"];

  options = options.sort((a, b) => {
    const aMatches = priority.filter(p =>
      a.targetName.toLowerCase().includes(p)
    );
    const bMatches = priority.filter(p =>
      b.targetName.toLowerCase().includes(p)
    );

    // If both match exactly one priority term, compare by its index in the list
    if (aMatches.length === 1 && bMatches.length === 1) {
      return priority.indexOf(aMatches[0]) - priority.indexOf(bMatches[0]);
    }

    // If only one has a match, that one wins
    if (aMatches.length === 1) return -1;
    if (bMatches.length === 1) return 1;

    // If both have multiple or no matches, sort alphabetically
    return a.targetName.localeCompare(b.targetName);
  });

  options.forEach(option => {
    if (option) {
      let _option = document.createElement("option");

      _option.setAttribute("key", option.targetName);
      _option.setAttribute("value", option.targetName);
      _option.textContent = option.targetName.toUpperCase();

      select.appendChild(_option);
    }
  });
}

async function GetBuildList(is_update_flow = false) {
  let response = await GET("/builds");
  wait(1000, HideLaoder);

  builds = response.builds ?? [];

  //render pipelines on screen if missing
  if (active_pipelines.length !== builds.length) {
    //missing some pipeline in ui add it
    let missing_pipelines = builds.filter(
      b =>
        !active_pipelines.includes(b.id) && !b.ended && !b.error && !b.isAborted
    );

    missing_pipelines.forEach(pipeline => add_pipeline(pipeline));
  }

  const apply_style_indicators = (build = build_interface) => {
    //points to the progress html element
    let build_container = document.querySelector(
      `#build-container-${build.id}`
    );

    let step_index = build.steps.indexOf(build.activeStep);
    let step_itr = 0;
    build_container.querySelectorAll("th").forEach(step => {
      //step completed successfully
      if (step_index > step_itr) {
        step.style.backgroundColor = "green";
      }

      //step in progress
      if (step_index === step_itr && !build.error && !build.isAborted) {
        step.classList.add("step-in-progress");
      } else if (step.classList.contains("step-in-progress")) {
        step.classList.remove("step-in-progress");
      }

      //aborted
      if (step_index === step_itr && build.isAborted) {
        step.style.backgroundColor = "darkgray";
      }

      //error on step
      if (build.error && step_index === step_itr) {
        step.style.backgroundColor = "red";
      }

      //pipeline complete
      if(!build.error && !build.isAborted && build.ended && step_index === step_itr){
        step.style.backgroundColor = "green";
        step.classList.remove("step-in-progress");
      }

      //increment counter
      step_itr++;
    });
  };

  builds.forEach(build => {
    let pipeline = document.querySelector(`#build-${build.id}`);

    //render any existing build if it is not in the ui
    if (!pipeline) render_build_component(build);

    //update progress
    if (is_update_flow) {
      if (pipeline) pipeline.value = build.percentage;

      if (build.percentage > 99 || build.ended || build.error) {
        remove_pipeline(build);
      }
    }

    apply_style_indicators(build);
  });
}

// prettier-ignore
function onLog(log) {
  let logPanel = document.querySelector("#logs-panel");
  let currentLogs = logPanel.value;

  let timestamp = new Date(log.timestamp);
  let local_date = timestamp.toLocaleDateString();
  let local_time = timestamp.toLocaleTimeString();

  currentLogs +=`[${log.level.toUpperCase()}] ${local_date}:${local_time} - ${log.message}` + "\n\n";
  logPanel.value = currentLogs;
}

async function StartPipeline(logCallback = onLog) {
  const target = document.querySelector("#enviornment-select").value;

  if (!target) {
    alert("Select a target for the pipeline to execute");
    return;
  }

  ShowLoader();

  try {
    // POST to /run-pipeline
    const response = await POST("/run-pipeline", { target });

    if (response.status !== 200) throw new Error("Pipeline failed to start");

    new_build = true;

    // Start listening for logs
    const eventSource = new EventSource("/logs-stream");

    eventSource.onmessage = event => {
      const log = JSON.parse(event.data);
      if (typeof logCallback === "function") {
        logCallback(log);
      }
    };

    eventSource.onerror = () => {
      console.error("Log stream disconnected.");
      eventSource.close();
    };
  } catch (err) {
    console.error("Error starting pipeline:", err);
    alert("An error occurred starting the pipeline: " + err);
  }
}

async function Abort() {
  ShowLoader();
  const response = await POST("/abort", {
    id: builds.sort((a, b) => new Date(b.started) - new Date(a.started))[0].id,
  });
  if (response.status !== 200) alert(JSON.stringify(response));
  HideLaoder();
}

//#endregion

function main() {
  ShowLoader();
  GetTargetList();
  GetBuildList();
  //updates build progress
  let itr = 0;
  cron(1000, () => {
    if (active_pipelines.length > 0 || new_build) {
      new_build = false;
      let is_update_flow = itr > 0;
      GetBuildList(is_update_flow);
      itr++;
    }
  });
}

main();
