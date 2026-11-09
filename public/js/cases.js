$(function () {
  const cfg = JSON.parse($('#cfg').text());
  const QUADS = ['UR', 'UL', 'LR', 'LL'];
  const $rows = $('#rows');
  const $alert = $('#alert');
  const $month = $('#month');
  const $doctor = $('#doctorFilter');
  const $form = $('#editForm');
  const modalEl = document.getElementById('editModal');
  const modal = modalEl ? new bootstrap.Modal(modalEl) : null;
  const challanModalEl = document.getElementById('challanModal');
  const challanModal = challanModalEl ? new bootstrap.Modal(challanModalEl) : null;
  const colspan = cfg.canEdit ? 14 : 12;

  let items = [];
  let editing = null;
  let qtyTouched = false;
  let rateTouched = false;
  let lastDoctor = '';
  let docRates = {}; // selected doctor's rates: work_type_id -> { rate, default_rate }
  let rateReq = 0;
  let alertTimer;
  const selected = new Set(); // case ids ticked for a delivery challan

  const esc = (v) => $('<div>').text(v ?? '').html();
  const inr = (n) =>
    Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const dmy = (s) => (s ? s.split('-').reverse().join('-') : '');
  const fmtTeeth = (t) =>
    QUADS.filter((q) => t?.[q]?.length).map((q) => `${q} ${t[q].join(',')}`).join(' · ');
  const monthLabel = (m) =>
    new Date(`${m}-01T00:00:00Z`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' });

  // Palmer-style cell like the paper register: upper row over lower row, right | left
  const palmer = (t) => {
    if (!QUADS.some((q) => t?.[q]?.length)) return '';
    const digits = (q, desc) =>
      (t[q] ?? []).slice().sort((a, b) => (desc ? b - a : a - b)).join('');
    return `<div class="pal" title="${esc(fmtTeeth(t))}">
      <span class="r">${digits('UR', true)}</span><span class="l">${digits('UL', false)}</span>
      <span class="r b">${digits('LR', true)}</span><span class="l b">${digits('LL', false)}</span>
    </div>`;
  };

  const flash = (msg, type = 'danger') => {
    $alert.attr('class', `alert alert-${type}`).text(msg);
    clearTimeout(alertTimer);
    alertTimer = setTimeout(() => $alert.addClass('d-none'), 5000);
  };
  const toLogin = () => (location.href = '/login');
  const onFail = (xhr) => (xhr.status === 401 ? toLogin() : flash(xhr.responseJSON?.error ?? 'Something went wrong'));

  // ---------- list ----------
  const visible = () => {
    const q = $('#search').val().trim().toLowerCase();
    if (!q) return items;
    return items.filter((c) =>
      [c.sr_no, c.patient_name, c.doctor, c.model_no, c.work_type, fmtTeeth(c.teeth), c.delivery_challan_no, c.notes]
        .some((v) => String(v ?? '').toLowerCase().includes(q))
    );
  };

  const selectedItems = () => items.filter((c) => selected.has(c.id));

  // The Issue button needs at least one ticked case, all of ONE doctor
  const refreshIssue = () => {
    if (!cfg.canEdit) return;
    const sel = selectedItems();
    const doctors = new Set(sel.map((c) => c.doctor_id));
    const ok = sel.length > 0 && doctors.size === 1;
    $('#issueBtn')
      .prop('disabled', !ok)
      .attr('title', doctors.size > 1 ? 'A challan can only include cases of one doctor' : '')
      .text(sel.length ? `Issue delivery challan (${sel.length})` : 'Issue delivery challan');
    const eligible = visible().filter((c) => !c.delivery_challan_id);
    $('#selectAll').prop('checked', eligible.length > 0 && eligible.every((c) => selected.has(c.id)));
  };

  const render = () => {
    const list = visible();
    if (!list.length) {
      $rows.html(`<tr><td colspan="${colspan}" class="text-center text-muted py-4">No cases for this selection</td></tr>`);
    } else {
      // column order = the paper register, then our billing columns (Qty, Rate, Total)
      $rows.html(
        list
          .map((c) => {
            const challaned = Boolean(c.delivery_challan_id);
            const blockedBy = c.invoice_id ? 'an invoice' : challaned ? 'a delivery challan' : '';
            return `<tr data-id="${c.id}">
              ${
                cfg.canEdit
                  ? `<td class="text-center"><input type="checkbox" class="form-check-input pick"
                       ${challaned ? 'disabled title="Already on a delivery challan"' : ''} ${selected.has(c.id) ? 'checked' : ''}></td>`
                  : ''
              }
              <td>${esc(c.sr_no)}</td>
              <td class="text-nowrap">${esc(dmy(c.case_date))}</td>
              <td>${esc(c.model_no)}</td>
              <td>${palmer(c.teeth)}</td>
              <td>${esc(c.work_type)}</td>
              <td>${esc(c.doctor)}</td>
              <td>${esc(c.patient_name)}</td>
              <td class="text-nowrap">${
                challaned
                  ? `<a href="/challans/${c.delivery_challan_id}" target="_blank" rel="noopener">${esc(c.delivery_challan_no)}</a>
                     <div class="small text-muted">${esc(dmy(c.delivery_challan_date))}</div>`
                  : ''
              }</td>
              <td class="text-nowrap">${esc(dmy(c.delivery_date))}</td>
              <td class="num">${esc(c.qty)}</td>
              <td class="num">${inr(c.rate)}</td>
              <td class="num">${inr(c.total)}</td>
              ${
                cfg.canEdit
                  ? `<td class="text-end text-nowrap">
                       <button class="btn btn-sm btn-outline-primary edit">Edit</button>
                       <button class="btn btn-sm btn-outline-danger del" ${blockedBy ? `disabled title="On ${blockedBy}. Cancel it first."` : ''}>Delete</button>
                     </td>`
                  : ''
              }
            </tr>`;
          })
          .join('')
      );
    }
    const cents = list.reduce((s, c) => s + Math.round(Number(c.total) * 100), 0);
    $('#summary').text(`${monthLabel($month.val())} · ${list.length} case${list.length === 1 ? '' : 's'} · Total ₹ ${inr(cents / 100)}`);
    refreshIssue();
  };

  const load = () => {
    selected.clear(); // a different month/doctor starts a fresh selection
    return $.getJSON('/api/cases', { month: $month.val(), doctor_id: $doctor.val() || undefined })
      .done((data) => {
        items = data;
        render();
      })
      .fail(onFail);
  };

  const shiftMonth = (delta) => {
    const [y, m] = $month.val().split('-').map(Number);
    $month.val(new Date(Date.UTC(y, m - 1 + delta, 1)).toISOString().slice(0, 7));
    load();
  };

  $month.val(cfg.today.slice(0, 7));
  $month.on('change', () => $month.val() && load());
  $doctor.on('change', load);
  $('#prevMonth').on('click', () => shiftMonth(-1));
  $('#nextMonth').on('click', () => shiftMonth(1));
  $('#search').on('input', render);

  if (cfg.canEdit) {
    // ---------- delivery challan: tick cases, issue ----------
    $rows.on('change', '.pick', function () {
      const id = Number($(this).closest('tr').data('id'));
      $(this).prop('checked') ? selected.add(id) : selected.delete(id);
      refreshIssue();
    });

    $('#selectAll').on('change', function () {
      const on = $(this).prop('checked');
      visible().filter((c) => !c.delivery_challan_id).forEach((c) => (on ? selected.add(c.id) : selected.delete(c.id)));
      render();
    });

    $('#issueBtn').on('click', () => {
      const sel = selectedItems();
      const cents = sel.reduce((s, c) => s + Math.round(Number(c.total) * 100), 0);
      $('#challanSummary').text(`${sel[0].doctor} · ${sel.length} case${sel.length === 1 ? '' : 's'} · ₹ ${inr(cents / 100)}`);
      $('#f_challan_date').val(cfg.today);
      $('#challanError').addClass('d-none');
      challanModal.show();
    });

    $('#challanForm').on('submit', (e) => {
      e.preventDefault();
      $('#issueConfirmBtn').prop('disabled', true);
      $.ajax({
        url: '/api/challans',
        method: 'POST',
        contentType: 'application/json',
        data: JSON.stringify({ case_ids: [...selected], challan_date: $('#f_challan_date').val() }),
      })
        .done((res) => (location.href = `/challans/${res.id}`)) // opens the printable challan
        .fail((xhr) => {
          if (xhr.status === 401) return toLogin();
          $('#challanError').text(xhr.responseJSON?.error ?? 'Something went wrong').removeClass('d-none');
          $('#issueConfirmBtn').prop('disabled', false);
        });
    });

    // ---------- teeth chart ----------
    const setTooth = ($b, on) =>
      $b.toggleClass('sel btn-primary', on).toggleClass('btn-outline-secondary', !on);

    const readTeeth = () => {
      const t = {};
      $('.tooth.sel').each(function () {
        const q = $(this).data('q');
        (t[q] = t[q] || []).push(Number($(this).data('n')));
      });
      QUADS.forEach((q) => t[q] && t[q].sort((a, b) => a - b));
      return t;
    };

    const writeTeeth = (t) => {
      setTooth($('.tooth'), false);
      QUADS.forEach((q) => (t?.[q] ?? []).forEach((n) => setTooth($(`.tooth[data-q="${q}"][data-n="${n}"]`), true)));
    };

    const countTeeth = () => $('.tooth.sel').length;

    const refreshTotal = () =>
      $('#totalPreview').text(`₹ ${inr((Number($('#f_qty').val()) || 0) * (Number($('#f_rate').val()) || 0))}`);

    $('.tooth').on('click', function () {
      setTooth($(this), !$(this).hasClass('sel'));
      if (!qtyTouched) $('#f_qty').val(Math.max(1, countTeeth()));
      refreshTotal();
    });

    $('#f_qty').on('input', () => {
      qtyTouched = true;
      refreshTotal();
    });

    const setHint = (t) => $('#rateHint').text(t);

    $('#f_rate').on('input', () => {
      rateTouched = true;
      setHint('Manual');
      refreshTotal();
    });

    // Suggest the doctor's own rate, else the work type's default. Never overwrites a typed or saved rate.
    const suggestRate = () => {
      if (rateTouched) return;
      const wtId = $('#f_work_type_id').val();
      if (!wtId) return;
      const r = docRates[wtId];
      const wt = cfg.workTypes.find((w) => String(w.id) === wtId);
      const rate = r ? (r.rate ?? r.default_rate) : wt?.default_rate;
      if (rate == null) return;
      $('#f_rate').val(Number(rate).toFixed(2));
      setHint(r && r.rate != null ? "Doctor's rate" : 'Default rate');
      refreshTotal();
    };

    const loadDoctorRates = () => {
      const doctorId = $('#f_doctor_id').val();
      const token = ++rateReq;
      docRates = {};
      if (!doctorId) return suggestRate();
      $.getJSON(`/api/doctors/${doctorId}/rates`)
        .done((d) => {
          if (token !== rateReq) return; // a newer doctor selection replaced this request
          docRates = Object.fromEntries(d.rates.map((r) => [String(r.work_type_id), r]));
          suggestRate();
        })
        .fail(onFail);
    };

    $('#f_work_type_id').on('change', suggestRate);
    $('#f_doctor_id').on('change', loadDoctorRates);

    // ---------- case modal ----------
    const openModal = (c) => {
      editing = c;
      const locked = Boolean(c?.delivery_challan_id);
      const billed = Boolean(c?.invoice_id); // on an issued invoice: charge fields are frozen
      qtyTouched = rateTouched = Boolean(c); // never overwrite saved values on edit
      $form[0].reset();
      $('#formError').addClass('d-none');
      $('#modalTitle').text(c ? `Edit case · Sr. No. ${c.sr_no}` : 'New case');
      $('#srNoText').text(c ? c.sr_no : 'Assigned on save');
      $('#saveAgainBtn').toggle(!c);
      $('#f_case_date').val(c?.case_date ?? cfg.today);
      $('#f_model_no').val(c?.model_no ?? '');
      writeTeeth(c?.teeth);
      $('#f_work_type_id').val(c?.work_type_id ? String(c.work_type_id) : '');
      $('#f_doctor_id').val(String(c?.doctor_id ?? (lastDoctor || $doctor.val() || ''))).prop('disabled', locked || billed);
      $('#doctorLockHint').text(billed ? 'Locked: this case is on an invoice' : locked ? 'Locked: this case is on a delivery challan' : '');
      $('#f_case_date, #f_work_type_id, #f_qty, #f_rate').prop('disabled', billed);
      $('#lockNote')
        .toggleClass('d-none', !billed)
        .text(billed ? `On invoice ${c.invoice_no}: date, doctor, work type, quantity and rate are locked. Cancel the invoice to change them.` : '');
      $('#f_patient_name').val(c?.patient_name ?? '');
      $('#challanText').text(locked ? `No. ${c.delivery_challan_no} · ${dmy(c.delivery_challan_date)}` : 'Not issued yet');
      $('#f_delivery_date').val(c?.delivery_date ?? '');
      $('#f_qty').val(c?.qty ?? 1);
      $('#f_rate').val(c ? Number(c.rate).toFixed(2) : '');
      $('#f_notes').val(c?.notes ?? '');
      refreshTotal();
      setHint('');
      if (c) {
        rateReq++; // saved values are never re-priced on edit
        docRates = {};
      } else {
        loadDoctorRates();
      }
      modal.show();
      setTimeout(() => $('#f_model_no').trigger('focus'), 300);
    };

    $('#addBtn').on('click', () => openModal(null));

    $rows.on('click', '.edit', function () {
      const id = Number($(this).closest('tr').data('id'));
      openModal(items.find((c) => c.id === id));
    });

    $rows.on('click', '.del', function () {
      const id = Number($(this).closest('tr').data('id'));
      const c = items.find((x) => x.id === id);
      if (!confirm(`Delete Sr. No. ${c.sr_no} (${c.patient_name})?`)) return;
      $.ajax({ url: `/api/cases/${id}`, method: 'DELETE' })
        .done(() => {
          flash('Deleted', 'success');
          load();
        })
        .fail(onFail);
    });

    $form.on('submit', (e) => {
      e.preventDefault();
      const again = e.originalEvent?.submitter?.id === 'saveAgainBtn';
      const payload = {
        case_date: $('#f_case_date').val(),
        model_no: $('#f_model_no').val(),
        teeth: readTeeth(),
        work_type_id: $('#f_work_type_id').val(),
        doctor_id: $('#f_doctor_id').val(),
        patient_name: $('#f_patient_name').val(),
        delivery_date: $('#f_delivery_date').val(),
        qty: $('#f_qty').val(),
        rate: $('#f_rate').val(),
        notes: $('#f_notes').val(),
      };
      $('#saveBtn, #saveAgainBtn').prop('disabled', true);
      $.ajax({
        url: editing ? `/api/cases/${editing.id}` : '/api/cases',
        method: editing ? 'PUT' : 'POST',
        contentType: 'application/json',
        data: JSON.stringify(payload),
      })
        .done((res) => {
          lastDoctor = payload.doctor_id;
          $month.val(payload.case_date.slice(0, 7)); // show the month the case was saved into
          flash(`Saved · Sr. No. ${res.sr_no}`, 'success');
          load();
          if (again && !editing) {
            openModal(null);
            $('#f_case_date').val(payload.case_date);
          } else {
            modal.hide();
          }
        })
        .fail((xhr) => {
          if (xhr.status === 401) return toLogin();
          $('#formError').text(xhr.responseJSON?.error ?? 'Something went wrong').removeClass('d-none');
        })
        .always(() => $('#saveBtn, #saveAgainBtn').prop('disabled', false));
    });
  }

  load();
});
