// Utility: wait for a number of milliseconds
function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Fetch with retry logic for 429, 500, 503
async function fetchWithRetry(url, options) {
  let attempt = 0;

  while (true) {
    attempt++;
    const res = await fetch(url, options);

    if (res.status === 429) {
      console.warn(`Rate limit (429) on attempt ${attempt}. Waiting 15s...`);
      await wait(15000);
      continue;
    }

    if (res.status === 500 || res.status === 503) {
      console.warn(`Retryable error (${res.status}) on attempt ${attempt}. Waiting 1s...`);
      await wait(1000);
      continue;
    }

    if (!res.ok) {
      throw new Error(`Request failed with status ${res.status}`);
    }

    const data = await res.json();
    return data;
  }
}

// Fetch one page of patients (20 per page)
async function fetchPatientsPage(page = 1) {
  const url = `https://assessment.ksensetech.com/api/patients?page=${page}&limit=20`;

  try {
    const response = await fetchWithRetry(url, {
      headers: {
        "x-api-key": "ak_034df9cf16216ec83e065f8060ff92d03d7b0c98442baf24"
      }
    });

    const raw = response.data ?? [];
    return Array.isArray(raw) ? raw : [];
  } catch (err) {
    console.error(`Hard failure on page ${page}:`, err.message);
    return [];
  }
}

// Fetch all patients across 3 pages (retries page if empty)
async function fetchAllPatients() {
  const allPatients = [];
  let page = 1;

  while (page <= 3) {
    console.log(`Requesting page ${page}...`);
    const patients = await fetchPatientsPage(page);

    if (!patients.length) {
      console.warn(`Page ${page} returned no patients. Retrying...`);
      continue;
    }

    allPatients.push(...patients);
    console.log(`✅ Page ${page} fetched. Total patients so far: ${allPatients.length}`);

    page++;
    await wait(1000);
  }

  console.log(`✅ Finished fetching ${allPatients.length} patients.`);
  return allPatients;
}

// Analyze patients and classify alerts
function assessPatients(patients) {
  const highRisk = [];
  const fever = [];
  const dataIssues = [];

  for (const p of patients) {
    const id = p.patient_id;

    // AGE
    const age = Number(p.age);
    const ageValid = Number.isFinite(age);
    let ageRisk = 0;
    if (ageValid) {
      if (age >= 66) ageRisk = 2;
      else if (age >= 40) ageRisk = 1;
    }

    // TEMP
    const temp = Number(p.temperature);
    const tempValid = Number.isFinite(temp);
    let tempRisk = 0;
    if (tempValid) {
      if (temp >= 101) tempRisk = 2;
      else if (temp >= 99.6) tempRisk = 1;
    }

    // BLOOD PRESSURE
    let bpRisk = 0;
    let bpValid = false;
    const bp = p.blood_pressure;
    const match = typeof bp === "string" ? bp.match(/^(\d{2,3})\/(\d{2,3})$/) : null;
    if (match) {
      const sys = Number(match[1]);
      const dia = Number(match[2]);
      bpValid = true;

      if (sys >= 140 || dia >= 90) bpRisk = 3;
      else if (sys >= 130 || dia >= 80) bpRisk = 2;
      else if (sys >= 120 && dia < 80) bpRisk = 1;
      else if (sys < 120 && dia < 80) bpRisk = 0;
    }

    // TOTAL RISK
    const totalRisk = ageRisk + tempRisk + bpRisk;

    // ALERT BUCKETS
    if (totalRisk >= 4) highRisk.push(id);
    if (tempValid && temp >= 99.6) fever.push(id);
    if (!bpValid || !ageValid || !tempValid) dataIssues.push(id);
  }

  return {
    highRiskPatients: highRisk,
    feverPatients: fever,
    dataQualityIssues: dataIssues
  };
}

// Run
async function main() {
  const patients = await fetchAllPatients();
  const alerts = assessPatients(patients);

  console.log("High-Risk Patients:", alerts.highRiskPatients);
  console.log("Fever Patients:", alerts.feverPatients);
  console.log("Data Quality Issues:", alerts.dataQualityIssues);

  const results = {
  high_risk_patients: alerts.highRiskPatients,
  fever_patients: alerts.feverPatients,
  data_quality_issues: alerts.dataQualityIssues
};

fetch('https://assessment.ksensetech.com/api/submit-assessment', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'x-api-key': "ak_034df9cf16216ec83e065f8060ff92d03d7b0c98442baf24"
  },
  body: JSON.stringify(results)
})
.then(response => response.json())
.then(data => {
  console.log('Assessment Results:', data);
});
}

main();