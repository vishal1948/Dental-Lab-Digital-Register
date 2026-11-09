// One entry per master table. Server routes AND the page UI are both generated from this.
export const masters = {
  doctors: {
    key: 'doctors',
    title: 'Doctors',
    path: '/doctors',
    api: '/api/doctors',
    table: 'doctors',
    orderBy: 'name',
    hasRates: true, // adds the per-doctor Rates screen
    columns: [
      { name: 'name', label: 'Doctor name', required: true },
      { name: 'clinic', label: 'Clinic' },
      { name: 'phone', label: 'Phone' },
    ],
  },
  workTypes: {
    key: 'work-types',
    title: 'Work types',
    path: '/work-types',
    api: '/api/work-types',
    table: 'work_types',
    orderBy: 'name',
    columns: [
      { name: 'name', label: 'Work type', required: true },
      { name: 'default_rate', label: 'Default rate (₹)', type: 'number', default: 0 },
    ],
  },
};
