$(function () {
  const modalEl = document.getElementById('invoiceModal');
  if (!modalEl) return; // viewers get the list only
  const modal = new bootstrap.Modal(modalEl);
  const $doctor = $('#n_doctor');
  const $month = $('#n_month');
  const $box = $('#previewBox');
  const $btn = $('#issueInvoiceBtn');
  const $err = $('#invoiceError');
  let req = 0;

  const inr = (n) => Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const bal = (n) => (Number(n) < 0 ? `${inr(Math.abs(n))} Cr` : inr(n));
  const toLogin = () => (location.href = '/login');

  const showError = (msg) => $err.text(msg).removeClass('d-none');

  // The numbers come from the server; show them before anything is issued
  const refresh = () => {
    const doctor = $doctor.val();
    const month = $month.val();
    $err.addClass('d-none');
    $btn.prop('disabled', true);
    if (!doctor || !month) return $box.empty();
    const token = ++req;
    $.getJSON('/api/invoices/preview', { doctor_id: doctor, month })
      .done((d) => {
        if (token !== req) return; // a newer selection replaced this request
        const rows = [
          ['Previous balance', `₹ ${bal(d.previous_balance)}`],
          [`This invoice (${d.case_count} case${d.case_count === 1 ? '' : 's'})`, `₹ ${inr(d.bill_total)}`],
          [`Less: payments received (${d.payment_count})`, `₹ ${inr(d.payments_total)}`],
          ['Total balance due', `₹ ${bal(d.total_balance)}`],
        ];
        const $table = $('<table class="table table-bordered table-grid table-sm mb-0"><tbody></tbody></table>');
        rows.forEach(([label, value], i) => {
          const $tr = $('<tr>').toggleClass('fw-bold', i === rows.length - 1);
          $tr.append($('<td>').text(label), $('<td class="num">').text(value));
          $table.find('tbody').append($tr);
        });
        $box.empty().append($table);
        if (d.waiting_count > 0) {
          $box.append($('<div class="small text-warning-emphasis mt-2">').text(
            `${d.waiting_count} more case${d.waiting_count === 1 ? ' is' : 's are'} not delivered yet. ${d.waiting_count === 1 ? 'It' : 'They'} will be billed after a delivery challan is issued.`));
        }
        if (d.problem) showError(d.problem);
        $btn.prop('disabled', !d.can_issue);
      })
      .fail((xhr) => {
        if (xhr.status === 401) return toLogin();
        $box.empty();
        showError(xhr.responseJSON?.error ?? 'Something went wrong');
      });
  };

  $('#newInvoiceBtn').on('click', () => {
    $doctor.val('');
    $month.val(modalEl.dataset.month); // usually the month that just ended
    $('#n_date').val(modalEl.dataset.today);
    $box.empty();
    $err.addClass('d-none');
    $btn.prop('disabled', true);
    modal.show();
  });

  $doctor.on('change', refresh);
  $month.on('change', refresh);

  $('#invoiceForm').on('submit', (e) => {
    e.preventDefault();
    $btn.prop('disabled', true);
    $.ajax({
      url: '/api/invoices',
      method: 'POST',
      contentType: 'application/json',
      data: JSON.stringify({ doctor_id: $doctor.val(), month: $month.val(), invoice_date: $('#n_date').val() }),
    })
      .done((res) => (location.href = `/invoices/${res.id}`)) // opens the printable invoice
      .fail((xhr) => {
        if (xhr.status === 401) return toLogin();
        showError(xhr.responseJSON?.error ?? 'Something went wrong');
        refresh();
      });
  });
});
