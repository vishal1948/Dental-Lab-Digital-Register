$(function () {
  const cfg = JSON.parse($('#cfg').text());
  const $rows = $('#rows');
  const $alert = $('#alert');
  const $form = $('#editForm');
  const modalEl = document.getElementById('editModal');
  const modal = modalEl ? new bootstrap.Modal(modalEl) : null;
  const hasActions = cfg.canEdit || cfg.hasRates;
  const colspan = cfg.columns.length + (hasActions ? 1 : 0);
  let items = [];
  let editingId = null;
  let alertTimer;

  const esc = (v) => $('<div>').text(v ?? '').html();
  const inr = (n) => Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const flash = (msg, type = 'danger') => {
    $alert.attr('class', `alert alert-${type}`).text(msg);
    clearTimeout(alertTimer);
    alertTimer = setTimeout(() => $alert.addClass('d-none'), 5000);
  };

  const onFail = (xhr) => {
    if (xhr.status === 401) return (location.href = '/login');
    flash(xhr.responseJSON?.error ?? 'Something went wrong');
  };

  const render = () => {
    const q = $('#search').val().trim().toLowerCase();
    const list = q
      ? items.filter((it) => cfg.columns.some((c) => String(it[c.name] ?? '').toLowerCase().includes(q)))
      : items;

    if (!list.length) {
      $rows.html(`<tr><td colspan="${colspan}" class="text-center text-muted py-4">Nothing to show</td></tr>`);
      return;
    }
    $rows.html(
      list
        .map((it) => {
          const cells = cfg.columns
            .map((c) => `<td>${esc(c.type === 'number' ? Number(it[c.name]).toFixed(2) : it[c.name])}</td>`)
            .join('');
          const actions = hasActions
            ? `<td class="text-end text-nowrap">
                 ${cfg.hasRates ? '<button class="btn btn-sm btn-outline-secondary rates">Rates</button>' : ''}
                 ${cfg.canEdit ? '<button class="btn btn-sm btn-outline-primary edit">Edit</button> <button class="btn btn-sm btn-outline-danger del">Delete</button>' : ''}
               </td>`
            : '';
          return `<tr data-id="${it.id}">${cells}${actions}</tr>`;
        })
        .join('')
    );
  };

  const load = () =>
    $.getJSON(cfg.api)
      .done((data) => {
        items = data;
        render();
      })
      .fail(onFail);

  $('#search').on('input', render);

  if (cfg.canEdit) {
    const openModal = (item) => {
      editingId = item?.id ?? null;
      $form[0].reset();
      $('#formError').addClass('d-none');
      $('#modalTitle').text(item ? 'Edit' : 'Add');
      cfg.columns.forEach((c) => $form.find(`[name="${c.name}"]`).val(item?.[c.name] ?? ''));
      modal.show();
    };

    $('#addBtn').on('click', () => openModal(null));

    $rows.on('click', '.edit', function () {
      const id = Number($(this).closest('tr').data('id'));
      openModal(items.find((it) => it.id === id));
    });

    $rows.on('click', '.del', function () {
      const id = Number($(this).closest('tr').data('id'));
      if (!confirm('Delete this entry?')) return;
      $.ajax({ url: `${cfg.api}/${id}`, method: 'DELETE' })
        .done(() => {
          flash('Deleted', 'success');
          load();
        })
        .fail(onFail);
    });

    $form.on('submit', (e) => {
      e.preventDefault();
      const payload = Object.fromEntries(
        cfg.columns.map((c) => [c.name, $form.find(`[name="${c.name}"]`).val()])
      );
      $('#saveBtn').prop('disabled', true);
      $.ajax({
        url: editingId ? `${cfg.api}/${editingId}` : cfg.api,
        method: editingId ? 'PUT' : 'POST',
        contentType: 'application/json',
        data: JSON.stringify(payload),
      })
        .done(() => {
          modal.hide();
          flash('Saved', 'success');
          load();
        })
        .fail((xhr) => {
          if (xhr.status === 401) return (location.href = '/login');
          $('#formError').text(xhr.responseJSON?.error ?? 'Something went wrong').removeClass('d-none');
        })
        .always(() => $('#saveBtn').prop('disabled', false));
    });
  }

  // ---------- per-doctor rates ----------
  if (cfg.hasRates) {
    const ratesModal = new bootstrap.Modal(document.getElementById('ratesModal'));
    const $body = $('#ratesBody');
    const $err = $('#ratesError');
    let ratesDoctor = null;
    let ratesReq = 0;

    const ratesFail = (xhr) => {
      if (xhr.status === 401) return (location.href = '/login');
      $err.text(xhr.responseJSON?.error ?? 'Something went wrong').removeClass('d-none');
    };

    const renderRates = (rates) => {
      if (!rates.length) {
        $body.html('<tr><td colspan="3" class="text-center text-muted py-3">Add work types first</td></tr>');
        return;
      }
      $body.html(
        rates
          .map(
            (r) => `<tr>
              <td>${esc(r.name)}</td>
              <td class="text-end text-muted">₹ ${inr(r.default_rate)}</td>
              <td style="width: 190px">
                <input type="number" step="0.01" min="0" class="form-control form-control-sm rate-input"
                       data-wt="${r.work_type_id}" placeholder="Default"
                       value="${r.rate == null ? '' : Number(r.rate).toFixed(2)}" ${cfg.canEdit ? '' : 'readonly'}>
              </td>
            </tr>`
          )
          .join('')
      );
    };

    $rows.on('click', '.rates', function () {
      const id = Number($(this).closest('tr').data('id'));
      ratesDoctor = items.find((it) => it.id === id);
      const token = ++ratesReq;
      $('#ratesTitle').text(`Rates · ${ratesDoctor.name}`);
      $err.addClass('d-none');
      $('#ratesNote').addClass('d-none');
      $body.html('<tr><td colspan="3" class="text-center text-muted py-3">Loading…</td></tr>');
      if (cfg.canEdit) {
        $('#copyFrom').html(
          '<option value="">Copy rates from another doctor…</option>' +
            items.filter((it) => it.id !== id).map((it) => `<option value="${it.id}">${esc(it.name)}</option>`).join('')
        );
      }
      ratesModal.show();
      $.getJSON(`${cfg.api}/${id}/rates`)
        .done((d) => token === ratesReq && renderRates(d.rates))
        .fail(ratesFail);
    });

    // Copy fills the inputs only; nothing is saved until "Save rates"
    $('#copyFrom').on('change', function () {
      const from = this.value;
      if (!from) return;
      const name = $(this).find('option:selected').text();
      $.getJSON(`${cfg.api}/${from}/rates`)
        .done((d) => {
          const map = new Map(d.rates.map((r) => [String(r.work_type_id), r.rate]));
          $body.find('.rate-input').each(function () {
            const v = map.get(String($(this).data('wt')));
            $(this).val(v == null ? '' : Number(v).toFixed(2));
          });
          $('#ratesNote').text(`Copied from ${name}. Review, then press Save rates.`).removeClass('d-none');
        })
        .fail(ratesFail);
      this.value = '';
    });

    $('#ratesForm').on('submit', (e) => {
      e.preventDefault();
      if (!cfg.canEdit || !ratesDoctor) return;
      const rates = $body
        .find('.rate-input')
        .map(function () {
          return { work_type_id: Number($(this).data('wt')), rate: $(this).val() };
        })
        .get();
      $('#ratesSave').prop('disabled', true);
      $.ajax({
        url: `${cfg.api}/${ratesDoctor.id}/rates`,
        method: 'PUT',
        contentType: 'application/json',
        data: JSON.stringify({ rates }),
      })
        .done(() => {
          ratesModal.hide();
          flash(`Rates saved for ${ratesDoctor.name}`, 'success');
        })
        .fail(ratesFail)
        .always(() => $('#ratesSave').prop('disabled', false));
    });
  }

  load();
});
