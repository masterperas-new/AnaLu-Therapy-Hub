const settingsForm = document.getElementById('settings-form');
const defaultFeeAmount = document.getElementById('defaultFeeAmount');

async function loadSettings() {
  const settings = await AppCommon.api('/api/settings');
  defaultFeeAmount.value = (settings.defaultFeeCents / 100).toFixed(2);
}

settingsForm.addEventListener('submit', async (event) => {
  event.preventDefault();

  try {
    await AppCommon.api('/api/settings', {
      method: 'PUT',
      body: JSON.stringify({ defaultFeeAmount: Number(defaultFeeAmount.value) }),
    });
    AppCommon.setMessage('Configuration saved.');
  } catch (error) {
    AppCommon.setMessage(error.message, true);
  }
});

AppCommon.ensureAuth(loadSettings);
