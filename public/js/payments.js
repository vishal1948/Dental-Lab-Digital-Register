$(function () {
  const cfg = JSON.parse($('#cfg').text());
  const $rows = $('#rows');
  const $alert = $('#alert');
  const $month = $('#month');
  const $doctor = $('#doctorFilter');
  const $form = $('#editForm');
  const modalEl = document.getElementById('editModal');
  const modal = modalEl ? new bootstrap.Modal(modalEl) : null;
  const colspan = cfg.canEdit ? 5 : 4;
  let items = [];
  let editing = null;
  let alertTimer;

  const esc = (v) => $('<div>').text(v ?? '').html();
  const inr = (n) => Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const dmy = (s) => (s ? s.split('-').reverse().join('-') : '');
  const monthLabel = (m) =>
    new Date(`${m}-01T00:00:00Z`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' });

  const flash = (msg, type = 'danger') => {
    $alert.attr('class', `alert alert-${type}`).text(msg);
    clearTimeout(alertTimer);
    alertTimer = setTimeout(() => $alert.addClass('d-none'), 5000);
  };
  const toLogin = () => (location.href = '/login');
  const onFail = (xhr) => (xhr.status === 401 ? toLogin() : flash(xhr.responseJSON?.error ?? 'Something went wrong'));

  const render = () => {
    if (!items.length) {
      $rows.html(`<tr><td colspan="${colspan}" class="text-center text-muted py-4">No payments for this selection</td></tr>`);
    } else {
      $rows.html(
        items
          .map(
            (p) => `<tr data-id="${p.id}">
              <td class="text-nowrap">${esc(dmy(p.paid_on))}</td>
              <td>${esc(p.doctor)}</td>
              <td class="num">${inr(p.amount)}</td>
              <td>${esc(p.note)}</td>
              ${
                cfg.canEdit
                  ? `<td class="text-end text-nowrap">
                       <button class="btn btn-sm btn-outline-primary edit">Edit</button>
                       <button class="btn btn-sm btn-outline-danger del">Delete</button>
                     </td>`
                  : ''
              }
            </tr>`
          )
          .join('')
      );
    }
    const total = items.reduce((s, p) => s + Math.round(Number(p.amount) * 100), 0);
    $('#summary').text(`${monthLabel($month.val())} · ${items.length} payment${items.length === 1 ? '' : 's'} · Total ₹ ${inr(total / 100)}`);
  };

  const load = () =>
    $.getJSON('/api/payments', { month: $month.val(), doctor_id: $doctor.val() || undefined })
      .done((data) => {
        items = data;
        render();
      })
      .fail(onFail);

  const shiftMonth = (delta) => {
    const [y, m] = $month.val().split('-').map(Number);
    $month.val(new Date(Date.UTC(y, m - 1 + delta, 1)).toISOString().slice(0, 7));
    load();
  };

  $month.val(cfg.today.slice(0, 7));
  if (cfg.doctorId) $doctor.val(String(cfg.doctorId));
  $month.on('change', () => $month.val() && load());
  $doctor.on('change', load);
  $('#prevMonth').on('click', () => shiftMonth(-1));
  $('#nextMonth').on('click', () => shiftMonth(1));

  if (cfg.canEdit) {
    const openModal = (p) => {
      editing = p;
      $form[0].reset();
      $('#formError').addClass('d-none');
      $('#modalTitle').text(p ? 'Edit payment' : 'Add payment');
      $('#f_paid_on').val(p?.paid_on ?? cfg.today);
      $('#f_doctor_id').val(String(p?.doctor_id ?? ($doctor.val() || '')));
      $('#f_amount').val(p ? Number(p.amount).toFixed(2) : '');
      $('#f_note').val(p?.note ?? '');
      modal.show();
      setTimeout(() => $('#f_amount').trigger('focus'), 300);
    };

    $('#addBtn').on('click', () => openModal(null));

    $rows.on('click', '.edit', function () {
      const id = Number($(this).closest('tr').data('id'));
      openModal(items.find((p) => p.id === id));
    });

    $rows.on('click', '.del', function () {
      const id = Number($(this).closest('tr').data('id'));
      const p = items.find((x) => x.id === id);
      if (!confirm(`Delete the ₹ ${inr(p.amount)} payment from ${p.doctor} (${dmy(p.paid_on)})?`)) return;
      $.ajax({ url: `/api/payments/${id}`, method: 'DELETE' })
        .done(() => {
          flash('Deleted', 'success');
          load();
        })
        .fail(onFail);
    });

    $form.on('submit', (e) => {
      e.preventDefault();
      const payload = {
        paid_on: $('#f_paid_on').val(),
        doctor_id: $('#f_doctor_id').val(),
        amount: $('#f_amount').val(),
        note: $('#f_note').val(),
      };
      $('#saveBtn').prop('disabled', true);
      $.ajax({
        url: editing ? `/api/payments/${editing.id}` : '/api/payments',
        method: editing ? 'PUT' : 'POST',
        contentType: 'application/json',
        data: JSON.stringify(payload),
      })
        .done(() => {
          $month.val(payload.paid_on.slice(0, 7)); // show the month the payment was saved into
          modal.hide();
          flash('Saved', 'success');
          load();
        })
        .fail((xhr) => {
          if (xhr.status === 401) return toLogin();
          $('#formError').text(xhr.responseJSON?.error ?? 'Something went wrong').removeClass('d-none');
        })
        .always(() => $('#saveBtn').prop('disabled', false));
    });
  }

  load();
});
