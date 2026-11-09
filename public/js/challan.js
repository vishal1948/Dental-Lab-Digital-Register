$(function () {
  $('#printBtn').on('click', () => window.print());

  $('#cancelBtn').on('click', function () {
    const id = $(this).data('id');
    if (!confirm('Cancel this challan? Its cases go back to "not delivered". The challan number is not reused.')) return;
    $.ajax({ url: `/api/challans/${id}`, method: 'DELETE' })
      .done(() => (location.href = '/cases'))
      .fail((xhr) => alert(xhr.responseJSON?.error ?? 'Something went wrong'));
  });
});
